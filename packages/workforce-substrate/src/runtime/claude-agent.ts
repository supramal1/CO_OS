// Claude Agent runtime.
//
// Implements the agent loop on top of Anthropic Messages API:
//   user prompt → assistant turn (text + 0..N tool_use) → dispatch tools →
//   tool_results → next assistant turn → ... → assistant turn with stop_reason
//   != "tool_use" → done.
//
// Locked behaviours:
// - Parallel tool_use blocks in one assistant turn dispatch concurrently
//   (Bug 5 lesson — count tool dispatches as distinct spans, not raw events).
// - AbortSignal propagates to the SDK call AND to in-flight tool dispatches
//   the moment cancellation arrives.
// - SDK exceptions, tool errors, and cancellations all return a structured
//   TaskResult — they never throw out of invokeAgent.

import Anthropic from "@anthropic-ai/sdk";
import { randomUUID } from "node:crypto";
import {
  AI_OPS_WORKSPACE,
  DEFAULT_CORNERSTONE_API_BASE_URL,
  type Agent,
  type AnthropicMessageParam,
  type AnthropicToolResultBlockParam,
  type EventLog,
  type InvocationOptions,
  type Task,
  type TaskError,
  type TaskResult,
  type TaskStatus,
  type Tool,
  type ToolBuildContext,
  type ToolBuilder,
  type ToolCallResult,
} from "../types.js";
import { InMemoryEventLog, createEventLog } from "../event-log.js";
import { loadSystemPrompt } from "../cookbook.js";

// ---------------------------------------------------------------------------
// SDK accessor (test seam)
// ---------------------------------------------------------------------------

export interface AnthropicClientLike {
  messages: {
    create: (
      params: Anthropic.Messages.MessageCreateParamsNonStreaming,
      options?: { signal?: AbortSignal },
    ) => Promise<Anthropic.Messages.Message>;
  };
}

export type AnthropicClientFactory = (apiKey: string) => AnthropicClientLike;

const defaultClientFactory: AnthropicClientFactory = (apiKey: string) =>
  new Anthropic({ apiKey }) as unknown as AnthropicClientLike;

// ---------------------------------------------------------------------------
// Cookbook system-prompt loader (test seam)
// ---------------------------------------------------------------------------

export type SystemPromptLoader = (skillName: string) => Promise<string>;

const defaultSystemPromptLoader: SystemPromptLoader = loadSystemPrompt;

// ---------------------------------------------------------------------------
// Cost rates for token accounting.
//
// Anthropic prices vary per model; the substrate captures usage from the
// API response and applies a small static rate table for cost in USD. Static
// rates are fine for v0 — Mal wants observable cost, not invoice-grade.
// Updated rates land in this table when models change pricing.
// ---------------------------------------------------------------------------

interface ModelRates {
  /** input $ per million tokens */
  readonly input: number;
  /** output $ per million tokens */
  readonly output: number;
  /** cache write $ per million tokens (5m TTL) */
  readonly cacheWrite: number;
  /** cache read $ per million tokens */
  readonly cacheRead: number;
}

const MODEL_RATES: Record<string, ModelRates> = {
  // Claude 4.x — values from the public price list as of April 2026.
  "claude-opus-4-7": { input: 15, output: 75, cacheWrite: 18.75, cacheRead: 1.5 },
  "claude-opus-4-6": { input: 15, output: 75, cacheWrite: 18.75, cacheRead: 1.5 },
  "claude-sonnet-4-6": { input: 3, output: 15, cacheWrite: 3.75, cacheRead: 0.3 },
  "claude-haiku-4-5-20251001": {
    input: 1,
    output: 5,
    cacheWrite: 1.25,
    cacheRead: 0.1,
  },
};

const FALLBACK_RATES: ModelRates = { input: 3, output: 15, cacheWrite: 3.75, cacheRead: 0.3 };

function priceUsage(model: string, usage: Anthropic.Messages.Usage): number {
  const rates = MODEL_RATES[model] ?? FALLBACK_RATES;
  const input = (usage.input_tokens ?? 0) * rates.input;
  const output = (usage.output_tokens ?? 0) * rates.output;
  const cacheCreate = (usage.cache_creation_input_tokens ?? 0) * rates.cacheWrite;
  const cacheRead = (usage.cache_read_input_tokens ?? 0) * rates.cacheRead;
  return (input + output + cacheCreate + cacheRead) / 1_000_000;
}

// ---------------------------------------------------------------------------
// invokeAgent
// ---------------------------------------------------------------------------

export interface InvokeAgentOptions extends InvocationOptions {
  /** test seam — override the Anthropic client factory */
  readonly clientFactory?: AnthropicClientFactory;
  /** test seam — override the Cookbook system-prompt loader */
  readonly systemPromptLoader?: SystemPromptLoader;
  /** Hard upper bound on assistant turns; defaults to 16. Stops runaway loops. */
  readonly maxTurns?: number;
}

export async function invokeAgent(
  agent: Agent,
  task: Task,
  options: InvokeAgentOptions = {},
): Promise<TaskResult> {
  const startedAt = Date.now();
  const taskId = task.id;
  const eventLog = options.eventLog ?? createEventLog({ taskId, agentId: agent.id });
  const boundLog =
    eventLog instanceof InMemoryEventLog
      ? eventLog.withBinding({ taskId, agentId: agent.id })
      : eventLog;

  boundLog.emit("task_started", {
    description: task.description,
    targetWorkspace: task.targetWorkspace ?? agent.defaultWorkspace,
    parentTaskId: task.parentTaskId ?? null,
    parentAgentId: task.parentAgentId ?? null,
    depth: options.depth ?? 0,
    model: agent.model,
    canDelegate: agent.canDelegate,
  });

  // ---- Resolve API keys / config ----
  const anthropicApiKey = options.anthropicApiKey ?? process.env.ANTHROPIC_API_KEY ?? "";
  const cornerstoneApiKey = options.cornerstoneApiKey ?? process.env.MEMORY_API_KEY ?? "";
  const cornerstoneApiBaseUrl =
    options.cornerstoneApiBaseUrl ??
    process.env.CORNERSTONE_API_URL ??
    DEFAULT_CORNERSTONE_API_BASE_URL;

  if (!anthropicApiKey) {
    return finaliseError(
      agent,
      task,
      eventLog,
      startedAt,
      "missing_anthropic_api_key",
      "ANTHROPIC_API_KEY env var (or invocation override) is required.",
    );
  }

  // ---- Build the per-invocation tool list ----
  const recursiveInvoker = options.depth !== undefined && options.roster
    ? buildChildInvoker(options, eventLog)
    : buildChildInvoker({ ...options, depth: options.depth ?? 0 }, eventLog);

  const toolBuildCtx: ToolBuildContext = {
    agent,
    task,
    eventLog: boundLog,
    invokeChild: recursiveInvoker,
    roster: options.roster,
    anthropicApiKey,
    cornerstoneApiKey,
    cornerstoneApiBaseUrl,
  };

  let tools: Tool[];
  try {
    tools = agent.toolBuilders.map((builder: ToolBuilder) => builder(toolBuildCtx));
  } catch (err) {
    return finaliseError(
      agent,
      task,
      eventLog,
      startedAt,
      "tool_build_error",
      err instanceof Error ? err.message : String(err),
      err,
    );
  }

  const customToolSpecs: Anthropic.Messages.ToolUnion[] = tools.map(
    (t): Anthropic.Messages.Tool => ({
      name: t.spec.name,
      description: t.spec.description,
      input_schema: t.spec.input_schema as Anthropic.Messages.Tool["input_schema"],
    }),
  );

  // Anthropic server-side web_search tool. Mounted by toolBuilders that opt in.
  // Detect by spec.name === "web_search" and convert.
  const finalToolSpecs: Anthropic.Messages.ToolUnion[] = customToolSpecs.map((t) => {
    if (t.name === "web_search") {
      return {
        type: "web_search_20250305",
        name: "web_search",
      } as Anthropic.Messages.ToolUnion;
    }
    return t;
  });

  // ---- Resolve system prompt from Cookbook ----
  const promptLoader = options.systemPromptLoader ?? defaultSystemPromptLoader;
  let systemPrompt: string;
  try {
    systemPrompt = await promptLoader(agent.systemPromptSkill);
  } catch (err) {
    return finaliseError(
      agent,
      task,
      eventLog,
      startedAt,
      "system_prompt_load_error",
      err instanceof Error ? err.message : String(err),
      err,
    );
  }

  // ---- Build initial user message ----
  const userMessageContent = renderUserMessage(task);

  // ---- Run the loop ----
  const clientFactory = options.clientFactory ?? defaultClientFactory;
  const client = clientFactory(anthropicApiKey);
  const messages: AnthropicMessageParam[] = [{ role: "user", content: userMessageContent }];
  const childResults: TaskResult[] = [];
  const toolByName = new Map<string, Tool>(tools.map((t) => [t.spec.name, t] as const));

  const maxTurns = options.maxTurns ?? 16;
  let totalCostUsd = 0;
  let finalText = "";
  let status: TaskStatus = "completed";
  let error: TaskError | undefined;

  try {
    for (let turn = 0; turn < maxTurns; turn++) {
      if (options.abortSignal?.aborted) {
        status = "cancelled";
        error = { code: "cancelled", message: "AbortSignal fired before model turn." };
        break;
      }

      const requestParams: Anthropic.Messages.MessageCreateParamsNonStreaming = {
        model: agent.model,
        max_tokens: 4096,
        system: systemPrompt,
        messages,
        tools: finalToolSpecs.length > 0 ? finalToolSpecs : undefined,
      };

      let response: Anthropic.Messages.Message;
      try {
        response = await client.messages.create(requestParams, {
          signal: options.abortSignal,
        });
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") {
          status = "cancelled";
          error = { code: "cancelled", message: "AbortSignal fired during model turn." };
          break;
        }
        status = "failed";
        error = {
          code: "anthropic_sdk_error",
          message: err instanceof Error ? err.message : String(err),
          detail: err,
        };
        break;
      }

      totalCostUsd += priceUsage(agent.model, response.usage);

      boundLog.emit("model_turn", {
        turn,
        stopReason: response.stop_reason,
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
        contentBlocks: response.content.length,
        runningCostUsd: round6(totalCostUsd),
      });

      // Capture assistant text — we keep the latest non-empty text as final output.
      const assistantText = response.content
        .filter((b): b is Anthropic.Messages.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("\n")
        .trim();
      if (assistantText.length > 0) finalText = assistantText;

      // Append the assistant turn to the running messages array verbatim.
      messages.push({ role: "assistant", content: response.content });

      if (response.stop_reason !== "tool_use") {
        // No tool calls — agent has finished.
        break;
      }

      // ---- Dispatch tool calls in parallel ----
      const toolUseBlocks = response.content.filter(
        (b): b is Anthropic.Messages.ToolUseBlock => b.type === "tool_use",
      );

      if (toolUseBlocks.length === 0) {
        // stop_reason was tool_use but no tool_use blocks — odd. Bail.
        break;
      }

      const dispatches = await Promise.all(
        toolUseBlocks.map(async (block) => {
          const tool = toolByName.get(block.name);
          boundLog.emit("tool_called", {
            turn,
            toolName: block.name,
            toolUseId: block.id,
            input: block.input,
          });
          if (!tool) {
            const result: ToolCallResult = {
              status: "error",
              output: `unknown tool '${block.name}'`,
              errorCode: "unknown_tool",
              errorMessage: `Tool '${block.name}' not configured for agent '${agent.id}'.`,
            };
            boundLog.emit("tool_returned", {
              turn,
              toolName: block.name,
              toolUseId: block.id,
              status: result.status,
              errorCode: result.errorCode,
            });
            return { block, result } as const;
          }
          let result: ToolCallResult;
          try {
            result = await tool.dispatch({
              name: block.name,
              toolUseId: block.id,
              input: (block.input ?? {}) as Record<string, unknown>,
            });
          } catch (err) {
            // Tool dispatchers shouldn't throw — but if they do, contain it.
            result = {
              status: "error",
              output: err instanceof Error ? err.message : String(err),
              errorCode: "tool_dispatch_threw",
              errorMessage: err instanceof Error ? err.message : String(err),
            };
          }
          boundLog.emit("tool_returned", {
            turn,
            toolName: block.name,
            toolUseId: block.id,
            status: result.status,
            errorCode: result.errorCode,
          });
          return { block, result } as const;
        }),
      );

      // ---- Collect any child TaskResults from delegate_task dispatches ----
      for (const { result } of dispatches) {
        const child = (result as ToolCallResult & { childResult?: TaskResult }).childResult;
        if (child) childResults.push(child);
      }

      // ---- Pack tool_results back into the next user message ----
      const toolResultsContent: AnthropicToolResultBlockParam[] = dispatches.map(
        ({ block, result }) => ({
          type: "tool_result",
          tool_use_id: block.id,
          content: serialiseToolOutput(result),
          is_error: result.status !== "ok",
        }),
      );
      messages.push({ role: "user", content: toolResultsContent });
    }

    if (status === "completed" && finalText === "") {
      // Loop exited without producing text — likely hit max turns.
      status = "failed";
      error = {
        code: "max_turns_exceeded",
        message: `Agent ${agent.id} did not return final text within ${maxTurns} turns.`,
      };
    }
  } catch (err) {
    status = "failed";
    error = {
      code: "runtime_unexpected_error",
      message: err instanceof Error ? err.message : String(err),
      detail: err,
    };
  }

  const result: TaskResult = {
    taskId,
    agentId: agent.id,
    status,
    output: status === "completed" ? finalText : "",
    eventLog: eventLog.entries(),
    costUsd: round6(totalCostUsd),
    durationMs: Date.now() - startedAt,
    children: childResults,
    error,
  };

  boundLog.emit(
    status === "completed"
      ? "task_completed"
      : status === "cancelled"
        ? "task_cancelled"
        : "task_failed",
    {
      status,
      costUsd: result.costUsd,
      durationMs: result.durationMs,
      errorCode: error?.code,
    },
  );

  return result;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildChildInvoker(
  options: InvokeAgentOptions,
  parentLog: EventLog,
): (childAgent: Agent, childTask: Task) => Promise<TaskResult> {
  return async (childAgent, childTask) => {
    return invokeAgent(childAgent, childTask, {
      ...options,
      eventLog: parentLog,
      depth: (options.depth ?? 0) + 1,
    });
  };
}

function renderUserMessage(task: Task): string {
  const lines: string[] = [];
  lines.push(task.description.trim());
  if (task.targetWorkspace) {
    lines.push("");
    lines.push(`(target Cornerstone workspace: ${task.targetWorkspace})`);
  }
  if (task.context && task.context.trim().length > 0) {
    lines.push("");
    lines.push("Additional context from delegator:");
    lines.push(task.context.trim());
  }
  return lines.join("\n");
}

function serialiseToolOutput(result: ToolCallResult): string {
  if (typeof result.output === "string") return result.output;
  try {
    return JSON.stringify(result.output ?? null, null, 2);
  } catch {
    return String(result.output ?? "");
  }
}

function round6(n: number): number {
  return Math.round(n * 1_000_000) / 1_000_000;
}

function finaliseError(
  agent: Agent,
  task: Task,
  eventLog: EventLog,
  startedAt: number,
  code: string,
  message: string,
  detail?: unknown,
): TaskResult {
  eventLog.emit("task_failed", {
    status: "failed" as TaskStatus,
    errorCode: code,
    durationMs: Date.now() - startedAt,
  });
  return {
    taskId: task.id,
    agentId: agent.id,
    status: "failed",
    output: "",
    eventLog: eventLog.entries(),
    costUsd: 0,
    durationMs: Date.now() - startedAt,
    children: [],
    error: { code, message, detail },
  };
}

// ---------------------------------------------------------------------------
// Public helper for constructing fresh root-level Tasks.
// ---------------------------------------------------------------------------

export function newTask(params: {
  description: string;
  targetWorkspace?: string;
  context?: string;
  maxCostUsd?: number;
}): Task {
  return {
    id: randomUUID(),
    description: params.description,
    targetWorkspace: params.targetWorkspace,
    parentTaskId: undefined,
    parentAgentId: undefined,
    ancestry: [],
    context: params.context,
    maxCostUsd: params.maxCostUsd,
  };
}

// Re-export the canonical workspace fallback for CLI consumers.
export { AI_OPS_WORKSPACE };
