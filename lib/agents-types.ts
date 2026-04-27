// Legacy task status kept for backwards read — backend still writes it
// alongside lane. The kanban no longer drives behaviour off it.
export type TaskStatus =
  | "submitted"
  | "scoping"
  | "building"
  | "ready"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

// Forge lifecycle lanes — source of truth on forge_tasks.lane since
// migration 047. The backend writes these at orchestration milestones
// (PM submit_scope → research_review, Builder PR open → production_review,
// close_task → done). The UI reads them via initial fetch + Supabase
// Realtime and only mutates them indirectly by POSTing to
// cornerstone-agents /invoke or /resume.
export type ForgeLane =
  | "backlog"
  | "research"
  | "research_review"
  | "production"
  | "production_review"
  | "done";

export type ForgeTask = {
  id: string;
  title: string;
  description: string | null;
  lane: ForgeLane;
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

export const LANE_ORDER: ForgeLane[] = [
  "backlog",
  "research",
  "research_review",
  "production",
  "production_review",
  "done",
];

export const LANE_LABEL: Record<ForgeLane, string> = {
  backlog: "Backlog",
  research: "Research",
  research_review: "Research Review",
  production: "Production",
  production_review: "Production Review",
  done: "Done",
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

export type BoardDropResolution =
  | { type: "transition"; fromLane: ForgeLane; toLane: ForgeLane }
  | { type: "noop" }
  | { type: "blocked"; message: string };

// Default target status when moving a task into a build-board column.
export const COLUMN_DEFAULT_STATUS: Record<BoardColumnId, TaskStatus> = {
  backlog: "submitted",
  in_progress: "building",
  review: "ready",
  done: "completed",
};

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

const LANE_TO_COLUMN: Record<ForgeLane, BoardColumnId> = {
  backlog: "backlog",
  research: "in_progress",
  production: "in_progress",
  research_review: "review",
  production_review: "review",
  done: "done",
};

export function boardColumnForLane(lane: ForgeLane): BoardColumnId {
  return LANE_TO_COLUMN[lane];
}

export function resolveBoardDrop(
  fromLane: ForgeLane,
  targetColumn: BoardColumnId,
): BoardDropResolution {
  if (boardColumnForLane(fromLane) === targetColumn) {
    return { type: "noop" };
  }

  if (fromLane === "backlog" && targetColumn === "in_progress") {
    return { type: "transition", fromLane, toLane: "research" };
  }
  if (fromLane === "research_review" && targetColumn === "in_progress") {
    return { type: "transition", fromLane, toLane: "production" };
  }
  if (fromLane === "production_review" && targetColumn === "done") {
    return { type: "transition", fromLane, toLane: "done" };
  }

  return { type: "blocked", message: blockedBoardDropMessage(fromLane) };
}

function blockedBoardDropMessage(fromLane: ForgeLane): string {
  if (fromLane === "research" || fromLane === "production") {
    return "Tasks move to Review automatically when work completes.";
  }
  if (fromLane === "backlog") {
    return "Backlog tasks must move to In progress first.";
  }
  if (fromLane === "research_review") {
    return "Research review tasks move to In progress when approved.";
  }
  if (fromLane === "production_review") {
    return "Production review tasks move to Done when approved.";
  }
  return "Done tasks can't be moved from this board.";
}

// Human-gated drags allowed in the UI. Any transition not listed here
// is rejected before the modal appears — skipping lanes, backward drags,
// and drags out of review gates all fail with a clear error. Automated
// transitions (research → research_review, production → production_review,
// production_review → done on approval) are driven by cornerstone-agents
// and arrive via Supabase Realtime, never via drag.
export const HUMAN_GATED_TRANSITIONS: Array<[ForgeLane, ForgeLane]> = [
  ["backlog", "research"],
  ["research_review", "production"],
  ["production_review", "done"],
];

export function isAllowedTransition(from: ForgeLane, to: ForgeLane): boolean {
  return HUMAN_GATED_TRANSITIONS.some(([f, t]) => f === from && t === to);
}

// Which cornerstone-agents endpoint a given human-gated transition maps to.
// /invoke kicks off a fresh PM run; /resume lifts the PM off a paused gate.
export type TransitionEndpoint =
  | { kind: "invoke" }
  | { kind: "resume"; gate: "scope" | "build" };

export function endpointForTransition(
  from: ForgeLane,
  to: ForgeLane,
): TransitionEndpoint | null {
  if (from === "backlog" && to === "research") return { kind: "invoke" };
  if (from === "research_review" && to === "production")
    return { kind: "resume", gate: "scope" };
  if (from === "production_review" && to === "done")
    return { kind: "resume", gate: "build" };
  return null;
}

// A lane is admin-only if dragging cards out of it could spend money or
// mutate production state. Used by the UI to gate the drag affordance
// and by the transition route as defence in depth.
export const ADMIN_ONLY_LANES: ReadonlySet<ForgeLane> = new Set<ForgeLane>([
  "backlog",
  "research_review",
  "production_review",
]);

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
