// HTTP-facing DTOs for the workforce API. We keep these distinct from the
// substrate's internal types so we never leak Anthropic SDK shapes or tool
// dispatch internals into the wire format.

import type {
  EventLogEntry,
  EventType,
  TaskStatus,
} from "@workforce/substrate";
import type { CostAlert } from "./cost-observability";

export type InvocationState =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "cancelled"
  | "rejected"
  | "blocked";

export interface PublicAgent {
  id: string;
  name: string;
  role: string;
  model: string;
  canDelegate: boolean;
  canUseCornerstoneRead: boolean;
  canUseCornerstoneWrite: boolean;
  reportsTo?: string;
  defaultWorkspace: string;
  toolSurface: string[];
}

export interface CreateTaskRequest {
  agentId: string;
  description: string;
  targetWorkspace?: string;
  context?: string;
  maxCostUsd?: number;
}

export interface CreateTaskResponse {
  taskId: string;
  agentId: string;
  state: InvocationState;
  startedAt: string;
  eventStreamUrl: string;
  statusUrl: string;
}

export interface TaskSummary {
  taskId: string;
  agentId: string;
  description: string;
  state: InvocationState;
  startedAt: string;
  completedAt?: string;
  costUsd: number;
  totalCostUsd: number;
  maxCostUsd?: number;
  costAlert: CostAlert;
  costRatio?: number;
  costOverrunPct?: number;
  durationMs: number;
  parentTaskId?: string;
  /**
   * If the task is running and there is an in-flight tool call (a
   * tool_called whose tool_returned hasn't arrived yet), this carries
   * the tool name AND the agentId of whoever fired it. The pixel
   * office walks that specific agent's sprite to the matching
   * station — which means delegation reads correctly: if Ada
   * delegates a web_search to Margaret, Margaret's sprite walks to
   * research while Ada stays at her desk.
   *
   * Only populated for in-memory tasks — DB-backed historical rows
   * leave this undefined since we don't reconstruct in-flight state
   * from persisted events.
   */
  currentTool?: { name: string; agentId: string };
  /**
   * Diagnostic only — strip back out once the office walking issue is
   * resolved. Lets the LIVE strip show why currentTool is missing.
   */
  _debug?: {
    inMemory: boolean;
    eventCount: number;
    toolCalledCount: number;
    toolReturnedCount: number;
    latestToolCalled?: string;
  };
}

export interface TaskDetail extends TaskSummary {
  output: string;
  error?: { code: string; message: string };
  events: PublicEventLogEntry[];
  children: TaskSummary[];
}

export interface PublicEventLogEntry {
  type: EventType;
  timestamp: string;
  seq: number;
  taskId: string;
  agentId: string;
  payload: Record<string, unknown>;
}

export interface HealthResponse {
  ok: boolean;
  rosterValid: boolean;
  rosterErrors: { code: string; message: string }[];
  leadId?: string;
  agentCount: number;
  substrateVersion: string;
  inflightTasks: number;
}

export type { EventLogEntry, TaskStatus };
