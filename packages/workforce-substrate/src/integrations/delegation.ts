// In-process recursive delegate_task tool.
//
// Locked architecture per co_ai_ops_delegation_architecture_locked: parent
// invokes the child synchronously, child runs in-process from the parent's
// perspective, child's TaskResult returns to the parent as a tool_result.
// HTTP transport arrives when the substrate lands on Cloud Run — v0 stays
// in-process so the entire delegation tree shares one EventLog, one cost
// rollup, and one cancellation signal.
//
// Locked guards (all enforced here):
// 1. Tool only mounted on agents with canDelegate=true. The roster builds
//    the tool list per-agent, so non-Lead agents never see this tool.
// 2. Self-delegation rejected at the dispatch site.
// 3. reportsTo validated: assignee must report to the parent (or be the
//    parent's peer in future multi-Lead rosters — v0 has one Lead).
// 4. Cycle detection via Task.ancestry — re-entering an in-flight task id
//    is rejected.
// 5. Depth limit: MAX_DELEGATION_DEPTH (3) walked from ancestry length.

import { randomUUID } from "node:crypto";
import {
  MAX_DELEGATION_DEPTH,
  type Agent,
  type Task,
  type TaskResult,
  type Tool,
  type ToolBuildContext,
  type ToolBuilder,
  type ToolCallInput,
  type ToolCallResult,
  type ToolSpec,
} from "../types.js";

const SPEC: ToolSpec = {
  name: "delegate_task",
  description: [
    "Hand a discrete task to a specialist agent under your reports-to chain.",
    "The specialist runs to completion and returns its final output as the",
    "tool result. Use this for any work outside your direct skill set —",
    "research, architecture, hygiene, implementation. Do NOT self-handle if a",
    "specialist exists for the task. The substrate enforces depth and cycle",
    "limits, so safe re-delegation is automatic.",
    "",
    "Input:",
    " - assigneeAgentName: agent slug (e.g. 'margaret', 'donald').",
    " - description: the natural-language task for the specialist.",
    " - targetWorkspace (optional): override Cornerstone workspace for the child.",
    "                              Defaults to the parent task's workspace.",
    " - context (optional): supplementary context the specialist should know.",
  ].join("\n"),
  input_schema: {
    type: "object",
    properties: {
      assigneeAgentName: {
        type: "string",
        description: "Slug of the specialist agent (e.g. 'margaret').",
      },
      description: {
        type: "string",
        description: "Natural-language task description for the specialist.",
      },
      targetWorkspace: {
        type: "string",
        description:
          "Optional Cornerstone workspace override. Inherits from parent task otherwise.",
      },
      context: {
        type: "string",
        description: "Optional extra context to include in the child's user message.",
      },
    },
    required: ["assigneeAgentName", "description"],
  },
};

/**
 * Build the delegate_task ToolBuilder. Only call this when constructing the
 * tool list for a Lead agent (canDelegate=true). The roster does not mount
 * this on non-Lead agents.
 */
export function buildDelegateTaskTool(): ToolBuilder {
  return (ctx: ToolBuildContext): Tool => {
    return {
      spec: SPEC,
      dispatch: async (call: ToolCallInput): Promise<ToolCallResult> =>
        delegateDispatch(ctx, call),
    };
  };
}

interface DelegateInput {
  assigneeAgentName: string;
  description: string;
  targetWorkspace?: string;
  context?: string;
}

async function delegateDispatch(
  ctx: ToolBuildContext,
  call: ToolCallInput,
): Promise<ToolCallResult> {
  const parentAgent = ctx.agent;
  const parentTask = ctx.task;

  // ---- Defensive: tool should not be mounted unless canDelegate ----
  if (!parentAgent.canDelegate) {
    return blocked("delegation_not_permitted", [
      `Agent '${parentAgent.id}' is not authorised to delegate.`,
      "delegate_task is only available to Lead agents.",
    ].join(" "));
  }

  // ---- Parse + validate input shape ----
  const parsed = parseInput(call.input);
  if ("error" in parsed) {
    return error("invalid_delegate_input", parsed.error);
  }
  const { assigneeAgentName, description, targetWorkspace, context } = parsed.value;

  // ---- Roster + invokeChild required ----
  if (!ctx.roster) {
    return error(
      "roster_unavailable",
      "delegate_task dispatched without a configured roster — runtime bug.",
    );
  }
  if (!ctx.invokeChild) {
    return error(
      "invoke_child_unavailable",
      "delegate_task dispatched without an invokeChild closure — runtime bug.",
    );
  }

  // ---- Resolve assignee (case-insensitive on agent.id and agent.name) ----
  const assignee = resolveAgent(ctx.roster, assigneeAgentName);
  if (!assignee) {
    return error(
      "assignee_not_found",
      `No agent matching '${assigneeAgentName}' in the v0 roster.`,
    );
  }

  // ---- Self-delegation rejected ----
  if (assignee.id === parentAgent.id) {
    return error(
      "self_delegation_forbidden",
      `Agent '${parentAgent.id}' may not delegate to itself.`,
    );
  }

  // ---- reportsTo enforcement ----
  // v0 has a single Lead. For Ada → specialist: assignee.reportsTo === 'ada'.
  // We accept either the assignee reporting directly to the parent OR the two
  // sharing a parent (peer relationship — Ada and Ada-peers in future multi-
  // lead rosters). v0 has no peers, so the second branch never fires today.
  if (
    assignee.reportsTo !== parentAgent.id &&
    !(parentAgent.reportsTo && assignee.reportsTo === parentAgent.reportsTo)
  ) {
    return error(
      "reports_to_violation",
      [
        `Agent '${assignee.id}' does not report to '${parentAgent.id}'`,
        `(reportsTo='${assignee.reportsTo ?? "<none>"}').`,
      ].join(" "),
    );
  }

  // ---- Cycle detection (checked before depth so a malformed lineage is
  // surfaced as the more specific cycle error rather than swallowed by
  // depth_exceeded) ----
  // If the parent task id already appears in its own ancestry, the lineage
  // chain is corrupted (programmer error or hand-crafted Task). Refuse to
  // recurse so the substrate doesn't perpetuate the loop.
  const currentLineage = new Set([...parentTask.ancestry, parentTask.id]);
  if (currentLineage.size !== parentTask.ancestry.length + 1) {
    return error(
      "ancestry_cycle_detected",
      `parentTask '${parentTask.id}' appears in its own ancestry — refusing.`,
    );
  }

  // ---- Depth limit ----
  // ancestry length == number of ancestor tasks above the current task.
  // The child task we're about to spawn would have ancestry.length === parent.ancestry.length + 1.
  const childAncestryLength = parentTask.ancestry.length + 1;
  if (childAncestryLength > MAX_DELEGATION_DEPTH) {
    return error(
      "max_depth_exceeded",
      [
        `Delegation depth would reach ${childAncestryLength}`,
        `(MAX_DELEGATION_DEPTH=${MAX_DELEGATION_DEPTH}).`,
        "Decline the work or surface a different plan.",
      ].join(" "),
    );
  }

  // ---- Build the child task ----
  const childTask: Task = {
    id: randomUUID(),
    description,
    targetWorkspace: targetWorkspace ?? parentTask.targetWorkspace,
    parentTaskId: parentTask.id,
    parentAgentId: parentAgent.id,
    ancestry: [...parentTask.ancestry, parentTask.id],
    context,
    maxCostUsd: parentTask.maxCostUsd,
  };

  ctx.eventLog.emit("delegate_initiated", {
    parentAgent: parentAgent.id,
    assignee: assignee.id,
    childTaskId: childTask.id,
    targetWorkspace: childTask.targetWorkspace ?? null,
    depth: childAncestryLength,
  });

  // ---- Recurse synchronously ----
  const childResult = await ctx.invokeChild(assignee, childTask);

  ctx.eventLog.emit("delegate_completed", {
    parentAgent: parentAgent.id,
    assignee: assignee.id,
    childTaskId: childTask.id,
    status: childResult.status,
    costUsd: childResult.costUsd,
    durationMs: childResult.durationMs,
    errorCode: childResult.error?.code ?? null,
  });

  // ---- Package the response for the parent's tool_result ----
  const toolResultBody = {
    status: childResult.status,
    output: childResult.output,
    costUsd: childResult.costUsd,
    durationMs: childResult.durationMs,
    error: childResult.error
      ? { code: childResult.error.code, message: childResult.error.message }
      : null,
    childTaskId: childTask.id,
    assignee: assignee.id,
  };

  // The runtime threads `childResult` back to invokeAgent so the parent's
  // TaskResult.children carries the full subtree. Attach it as a non-spec
  // extension on the ToolCallResult.
  if (childResult.status === "completed") {
    return {
      status: "ok",
      output: toolResultBody,
      childResult,
    } as ToolCallResult & { childResult?: TaskResult };
  }
  return {
    status: "error",
    output: toolResultBody,
    errorCode: childResult.error?.code ?? `child_${childResult.status}`,
    errorMessage:
      childResult.error?.message ??
      `Child agent terminated with status '${childResult.status}'.`,
    childResult,
  } as ToolCallResult & { childResult?: TaskResult };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseInput(
  raw: Record<string, unknown>,
): { value: DelegateInput } | { error: string } {
  const assigneeAgentName = raw["assigneeAgentName"];
  const description = raw["description"];
  const targetWorkspace = raw["targetWorkspace"];
  const context = raw["context"];

  if (typeof assigneeAgentName !== "string" || assigneeAgentName.trim() === "") {
    return { error: "delegate_task requires a non-empty 'assigneeAgentName' string." };
  }
  if (typeof description !== "string" || description.trim() === "") {
    return { error: "delegate_task requires a non-empty 'description' string." };
  }
  if (targetWorkspace !== undefined && typeof targetWorkspace !== "string") {
    return { error: "'targetWorkspace' must be a string when provided." };
  }
  if (context !== undefined && typeof context !== "string") {
    return { error: "'context' must be a string when provided." };
  }

  return {
    value: {
      assigneeAgentName: assigneeAgentName.trim(),
      description: description.trim(),
      targetWorkspace: targetWorkspace?.trim() || undefined,
      context: context?.trim() || undefined,
    },
  };
}

function resolveAgent(
  roster: ReadonlyMap<string, Agent>,
  needle: string,
): Agent | undefined {
  const lowered = needle.toLowerCase();
  // Direct id hit (most common case — agents call each other by slug).
  const direct = roster.get(lowered);
  if (direct) return direct;
  // Fall back to scanning by id / name case-insensitively.
  for (const agent of roster.values()) {
    if (agent.id.toLowerCase() === lowered) return agent;
    if (agent.name.toLowerCase() === lowered) return agent;
  }
  return undefined;
}

function error(code: string, message: string): ToolCallResult {
  return {
    status: "error",
    output: { error: code, message },
    errorCode: code,
    errorMessage: message,
  };
}

function blocked(code: string, message: string): ToolCallResult {
  return {
    status: "blocked",
    output: { error: code, message },
    errorCode: code,
    errorMessage: message,
  };
}
