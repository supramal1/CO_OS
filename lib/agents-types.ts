export type TaskStatus =
  | "submitted"
  | "scoping"
  | "building"
  | "ready"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export type ForgeTask = {
  id: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  agent_id: string | null;
  priority: number;
  creator_type: string | null;
  creator_id: string | null;
  assignee_type: string | null;
  assignee_id: string | null;
  metadata: Record<string, unknown> | null;
  namespace: string;
  created_at: string;
  updated_at: string;
};

export type BoardColumnId = "backlog" | "in_progress" | "review" | "done";

export const COLUMN_ORDER: BoardColumnId[] = [
  "backlog",
  "in_progress",
  "review",
  "done",
];

export const COLUMN_LABEL: Record<BoardColumnId, string> = {
  backlog: "Backlog",
  in_progress: "In progress",
  review: "Review",
  done: "Done",
};

// Default target status when moving a task into a given column.
export const COLUMN_DEFAULT_STATUS: Record<BoardColumnId, TaskStatus> = {
  backlog: "submitted",
  in_progress: "building",
  review: "ready",
  done: "completed",
};

// Map each granular task status onto a board column.
const STATUS_TO_COLUMN: Record<TaskStatus, BoardColumnId> = {
  submitted: "backlog",
  scoping: "backlog",
  building: "in_progress",
  running: "in_progress",
  ready: "review",
  completed: "done",
  failed: "done",
  cancelled: "done",
};

export function columnFor(status: TaskStatus): BoardColumnId {
  return STATUS_TO_COLUMN[status];
}

export const STATUS_LABEL: Record<TaskStatus, string> = {
  submitted: "Submitted",
  scoping: "Scoping",
  building: "Building",
  ready: "Ready",
  running: "Running",
  completed: "Completed",
  failed: "Failed",
  cancelled: "Cancelled",
};

export const ALL_STATUSES: TaskStatus[] = [
  "submitted",
  "scoping",
  "building",
  "ready",
  "running",
  "completed",
  "failed",
  "cancelled",
];
