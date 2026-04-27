// Public surface for @co/workforce-substrate.
// v0 — single-process, in-memory, CLI-only.

export type {
  Agent,
  Task,
  TaskResult,
  TaskStatus,
  TaskError,
  ToolSpec,
  Tool,
  ToolBuilder,
  ToolBuildContext,
  ToolCallInput,
  ToolCallResult,
  ToolCallResultStatus,
  EventLog,
  EventLogEntry,
  EventType,
  InvocationOptions,
  ApprovalRequest,
  ApprovalDecision,
} from "./types.js";

export {
  MAX_DELEGATION_DEPTH,
  DEFAULT_CORNERSTONE_API_BASE_URL,
  AI_OPS_WORKSPACE,
} from "./types.js";

export { InMemoryEventLog, createEventLog } from "./event-log.js";

export { invokeAgent, newTask } from "./runtime/claude-agent.js";

export {
  buildCornerstoneReadTools,
  buildCornerstoneWriteTools,
  buildAllCornerstoneTools,
} from "./integrations/cornerstone.js";

export {
  githubTool,
  githubToolBuilders,
  GRACE_GITHUB_TOOL_NAMES,
} from "./integrations/github.js";

export { buildDelegateTaskTool } from "./integrations/delegation.js";

export { ada } from "./agents/ada.js";
export { alan } from "./agents/alan.js";
export { grace } from "./agents/grace.js";
export { margaret } from "./agents/margaret.js";
export { donald } from "./agents/donald.js";

export { getRoster, getAgent, validateRoster } from "./roster.js";
