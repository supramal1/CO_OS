// HTTP-facing DTOs for the workforce API. We keep these distinct from the
// substrate's internal types so we never leak Anthropic SDK shapes or tool
// dispatch internals into the wire format.

import type {
  EventLogEntry,
  EventType,
  TaskStatus,
} from "@workforce/substrate";

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
  durationMs: number;
  parentTaskId?: string;
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
