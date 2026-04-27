// CO Workforce Substrate v0 — core contracts.
//
// v0 is single-process synchronous invocation. CLI only. No HTTP API. No
// persistent task storage. delegate_task works via in-process recursion (HTTP
// arrives when this lands on Cloud Run).
//
// Locked architecture per co_workforce_harness_pivot_decision and
// co_ai_ops_delegation_architecture_locked. Do not redesign these shapes
// without updating both Cornerstone facts.

import type { Anthropic } from "@anthropic-ai/sdk";

// ---------------------------------------------------------------------------
// Agent
// ---------------------------------------------------------------------------

/**
 * An Agent is the static configuration that describes one workforce member.
 * System prompts are loaded from Cookbook by `systemPromptSkill` name at
 * roster build time — they are never duplicated in code.
 */
export interface Agent {
  /** stable slug, e.g. "ada", "alan", "grace", "margaret", "donald" */
  readonly id: string;
  /** display name, e.g. "Ada", "Alan" */
  readonly name: string;
  /** Cookbook skill name whose body is the agent's system prompt */
  readonly systemPromptSkill: string;
  /** Anthropic model id (e.g. "claude-opus-4-7", "claude-sonnet-4-6") */
  readonly model: string;
  /** Tool builders this agent has access to. Resolved per-invocation. */
  readonly toolBuilders: readonly ToolBuilder[];
  /** Lead-only flag enforced at delegate_task call sites. */
  readonly canDelegate: boolean;
  /** Whether the agent gets Cornerstone read tools mounted. */
  readonly canUseCornerstoneRead: boolean;
  /** Whether the agent gets Cornerstone write tools mounted. */
  readonly canUseCornerstoneWrite: boolean;
  /**
   * Opt-in flag for agents whose role naturally produces long structured
   * output (e.g. research briefings). Raises per-turn `max_tokens` from 4096
   * to 8192. Lead agents already get 8192 unconditionally — this flag is
   * for specialists. Default false.
   */
  readonly outputHeavy?: boolean;
  /** Optional reportsTo agent id. Undefined for the Lead. */
  readonly reportsTo?: string;
  /** Default workspace name. Used as fallback when Task lacks targetWorkspace. */
  readonly defaultWorkspace: string;
}

// ---------------------------------------------------------------------------
// Task
// ---------------------------------------------------------------------------

/**
 * A Task is a single unit of work for a single Agent. Tasks are immutable
 * after construction — invocation context (event log, cost) is held on the
 * Invocation, not the Task.
 *
 * Lineage fields (parentTaskId, parentAgentId) are populated automatically by
 * the delegate_task tool when a parent invokes a child. Manual construction
 * leaves them undefined.
 */
export interface Task {
  /** uuid */
  readonly id: string;
  /** the natural-language task description handed to the agent */
  readonly description: string;
  /** Cornerstone workspace name for this task; falls back to agent.defaultWorkspace */
  readonly targetWorkspace?: string;
  /** parent task id when this task was spawned via delegate_task */
  readonly parentTaskId?: string;
  /** parent agent id when this task was spawned via delegate_task */
  readonly parentAgentId?: string;
  /** ordered list of ancestor task ids — used for cycle detection / depth */
  readonly ancestry: readonly string[];
  /** optional structured context the parent passes to the child */
  readonly context?: string;
  /** optional max-cost in dollars for this entire invocation tree */
  readonly maxCostUsd?: number;
}

// ---------------------------------------------------------------------------
// TaskResult
// ---------------------------------------------------------------------------

export type TaskStatus =
  | "completed"
  | "failed"
  | "cancelled"
  | "rejected"
  | "blocked";

export interface TaskError {
  readonly code: string;
  readonly message: string;
  /** Optional structured detail from the underlying source (SDK, tool, etc.) */
  readonly detail?: unknown;
}

export interface TaskResult {
  readonly taskId: string;
  readonly agentId: string;
  readonly status: TaskStatus;
  /** The agent's final assistant text. Empty string when status != completed. */
  readonly output: string;
  /** Ordered structured events captured during the invocation. */
  readonly eventLog: readonly EventLogEntry[];
  /** Total input + output token cost in USD for THIS invocation only. */
  readonly costUsd: number;
  /** This invocation plus every descendant task spawned by delegate_task. */
  readonly totalCostUsd: number;
  /** Wall-clock duration in milliseconds. */
  readonly durationMs: number;
  /** Populated when status is failed / cancelled / rejected / blocked. */
  readonly error?: TaskError;
  /** Subordinate task results when this invocation called delegate_task. */
  readonly children: readonly TaskResult[];
}

// ---------------------------------------------------------------------------
// Tool
// ---------------------------------------------------------------------------

/**
 * The Claude Agent SDK accepts custom tools as input_schema + name +
 * description + an async callback. We wrap that with a builder so the runtime
 * can mint per-invocation closures (each Cornerstone tool needs a closure
 * over the task's targetWorkspace, the company-scoped API key, etc.).
 */
export interface ToolSpec {
  readonly name: string;
  readonly description: string;
  readonly input_schema: {
    readonly type: "object";
    readonly properties: Record<string, unknown>;
    readonly required?: readonly string[];
  };
}

export interface ToolCallInput {
  readonly name: string;
  readonly toolUseId: string;
  readonly input: Record<string, unknown>;
}

export type ToolCallResultStatus = "ok" | "error" | "blocked";

// ---------------------------------------------------------------------------
// Approval hook (Path Y — see docs/superpowers/specs/2026-04-26-wf6-approval-inbox-design.md)
//
// A tool dispatcher that wants human gating calls ctx.requestApproval(...)
// before performing the destructive action. The runtime returns a Promise
// that resolves when an operator approves/rejects via the inbox UI. While
// the Promise is pending, the substrate's invocation loop is parked on
// `await dispatch(...)` — no checkpointing required because the in-memory
// closure (messages array, AbortSignal, EventLog) stays alive.
// ---------------------------------------------------------------------------

export interface ApprovalRequest {
  /** Tool name presenting the request (e.g. "steward_apply"). */
  readonly toolName: string;
  /** The exact tool input that will be replayed if approved. */
  readonly input: Record<string, unknown>;
  /** Human-readable summary of what will happen — rendered in the modal. */
  readonly preview: string;
  /**
   * Optional structured detail surfaced alongside the preview (e.g. the
   * raw steward_preview audit). Keep it JSON-serialisable.
   */
  readonly detail?: unknown;
}

export interface ApprovalDecision {
  readonly approved: boolean;
  /** Persisted audit state. Defaults to approved/rejected from `approved`. */
  readonly state?: "approved" | "rejected" | "cancelled";
  /** Optional operator-supplied reason. Always populated on rejection. */
  readonly reason?: string;
  /** Operator identifier if available (principalId, "system", etc.). */
  readonly resolvedBy?: string;
}

export interface ToolCallResult {
  readonly status: ToolCallResultStatus;
  /** JSON-serialisable output returned to the model as tool_result content. */
  readonly output: unknown;
  /** Populated for error / blocked status. */
  readonly errorCode?: string;
  readonly errorMessage?: string;
}

export interface Tool {
  readonly spec: ToolSpec;
  /** Async dispatcher. Must never throw — return a ToolCallResult instead. */
  readonly dispatch: (input: ToolCallInput) => Promise<ToolCallResult>;
}

/**
 * A ToolBuilder takes the live invocation context and emits a Tool. This is
 * how we close over the per-task targetWorkspace, parent lineage, and any
 * other invocation-specific state.
 */
export type ToolBuilder = (ctx: ToolBuildContext) => Tool;

export interface ToolBuildContext {
  readonly agent: Agent;
  readonly task: Task;
  readonly eventLog: EventLog;
  /** Recursive invoker — only present when delegate_task is being built. */
  readonly invokeChild?: (childAgent: Agent, childTask: Task) => Promise<TaskResult>;
  /** Roster lookup for delegate_task name → Agent resolution. */
  readonly roster?: ReadonlyMap<string, Agent>;
  /** Anthropic API key, threaded through for SDK calls and Cornerstone API. */
  readonly anthropicApiKey: string;
  /** Cornerstone API key, resolved per-company / per-agent. */
  readonly cornerstoneApiKey: string;
  /** Cornerstone API base URL. Defaults to prod endpoint. */
  readonly cornerstoneApiBaseUrl: string;
  /**
   * GitHub PAT for Grace's tools. Optional — absent means the tool surface
   * returns `github_pat_missing` at dispatch time. Resolved by the runtime
   * from InvocationOptions or process.env.GRACE_GITHUB_PAT; never read
   * directly by tool dispatchers.
   */
  readonly graceGithubPat?: string;
  /** GitHub org for Grace's tools. Defaults to "Forgeautomatedrepo". */
  readonly graceGithubOrg?: string;
  /** Branch-namespace prefix for Grace's writes. Defaults to "grace/". */
  readonly graceGithubBranchPrefix?: string;
  /**
   * Human-approval hook. Tool dispatchers call this before a destructive
   * action and await the operator's decision. Optional — when undefined,
   * tools that require approval should fall back to a "blocked" result
   * (preserves the current v0 behaviour for environments without the
   * inbox UI wired up, e.g. CLI / unit tests).
   */
  readonly requestApproval?: (req: ApprovalRequest) => Promise<ApprovalDecision>;
}

// ---------------------------------------------------------------------------
// EventLog
// ---------------------------------------------------------------------------

export type EventType =
  | "task_started"
  | "task_completed"
  | "task_failed"
  | "task_cancelled"
  | "model_turn"
  | "tool_called"
  | "tool_returned"
  | "delegate_initiated"
  | "delegate_completed"
  | "approval_requested"
  | "approval_resolved";

export interface EventLogEntry {
  readonly type: EventType;
  /** ISO-8601 timestamp */
  readonly timestamp: string;
  /** monotonic sequence number within an invocation */
  readonly seq: number;
  /** task id this event belongs to */
  readonly taskId: string;
  /** agent id that produced the event */
  readonly agentId: string;
  /** structured payload — shape depends on type */
  readonly payload: Record<string, unknown>;
}

/**
 * Event log API. Implementations can choose to additionally stream events to
 * stderr / a file / a Cloud Run log sink — the substrate only requires that
 * `entries()` returns the ordered list when an invocation completes.
 */
export interface EventLog {
  emit(type: EventType, payload: Record<string, unknown>): EventLogEntry;
  entries(): readonly EventLogEntry[];
}

// ---------------------------------------------------------------------------
// Invocation
// ---------------------------------------------------------------------------

export interface InvocationOptions {
  /** AbortSignal for cooperative cancellation. */
  readonly abortSignal?: AbortSignal;
  /** Override default Anthropic API key (uses ANTHROPIC_API_KEY env otherwise). */
  readonly anthropicApiKey?: string;
  /** Override Cornerstone API key (uses MEMORY_API_KEY env otherwise). */
  readonly cornerstoneApiKey?: string;
  /** Override Cornerstone API base URL. */
  readonly cornerstoneApiBaseUrl?: string;
  /** Pre-built event log. Used by delegate_task to share a log across the tree. */
  readonly eventLog?: EventLog;
  /** Pre-built roster. Required when the runtime needs to resolve delegate_task targets. */
  readonly roster?: ReadonlyMap<string, Agent>;
  /** Recursion depth — incremented automatically by delegate_task. */
  readonly depth?: number;
  /** GitHub PAT for Grace's tools. Falls back to process.env.GRACE_GITHUB_PAT. */
  readonly graceGithubPat?: string;
  /** GitHub org for Grace's tools. Falls back to process.env.GRACE_GITHUB_ORG. */
  readonly graceGithubOrg?: string;
  /** Branch-namespace prefix for Grace's writes. Falls back to process.env.GRACE_BRANCH_PREFIX. */
  readonly graceGithubBranchPrefix?: string;
  /**
   * Human-approval hook. The runner provides an implementation that
   * persists the request, registers a deferred Promise, and waits for the
   * inbox UI to resolve it. Absent in CLI / unit-test contexts where the
   * default "blocked" fallback is the desired behaviour.
   */
  readonly requestApproval?: (req: ApprovalRequest) => Promise<ApprovalDecision>;
}

// ---------------------------------------------------------------------------
// Anthropic SDK message types — re-exported for convenience.
// ---------------------------------------------------------------------------

export type AnthropicMessage = Anthropic.Messages.Message;
export type AnthropicMessageParam = Anthropic.Messages.MessageParam;
export type AnthropicContentBlock = Anthropic.Messages.ContentBlock;
export type AnthropicToolUseBlock = Anthropic.Messages.ToolUseBlock;
export type AnthropicToolResultBlockParam = Anthropic.Messages.ToolResultBlockParam;

// ---------------------------------------------------------------------------
// Constants — locked architecture parameters.
// ---------------------------------------------------------------------------

/**
 * Maximum delegation recursion depth. Ada → Donald → Donald-of-Donald is
 * already pathological. Three-deep gives us Ada → specialist → specialist
 * (rare but conceivable) without permitting unbounded loops.
 */
export const MAX_DELEGATION_DEPTH = 3;

/** Default Cornerstone production API base URL. */
export const DEFAULT_CORNERSTONE_API_BASE_URL =
  "https://cornerstone-api-lymgtgeena-nw.a.run.app";

/** Canonical AI Ops workspace. */
export const AI_OPS_WORKSPACE = "aiops";
