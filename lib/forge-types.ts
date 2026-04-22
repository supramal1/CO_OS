export type BriefFrequency = "daily" | "weekly" | "monthly" | "quarterly" | "one-off";
export type BriefScope = "individual" | "team" | "agency" | "client";
export type BriefUrgency = "low" | "medium" | "high" | "critical";
export type BriefStatus =
  | "submitted"
  | "triaged"
  | "in_progress"
  | "blocked"
  | "resolved"
  | "rejected";

export const BRIEF_STATUSES: BriefStatus[] = [
  "submitted",
  "triaged",
  "in_progress",
  "blocked",
  "resolved",
  "rejected",
];

export type Brief = {
  id: string;
  title: string;
  problem_statement: string;
  frequency: BriefFrequency | null;
  time_cost_minutes: number | null;
  affected_scope: BriefScope | null;
  desired_outcome: string | null;
  urgency: BriefUrgency | null;
  submitter_id: string | null;
  status: BriefStatus;
  admin_notes: string | null;
  resolution: string | null;
  resulting_agent_id: string | null;
  resulting_task_ids: string[] | null;
  namespace: string;
  created_at: string;
  updated_at: string;
};

export type BriefStats = {
  total: number;
  by_status: Record<BriefStatus, number>;
};

export const STATUS_LABEL: Record<BriefStatus, string> = {
  submitted: "Submitted",
  triaged: "Triaged",
  in_progress: "In progress",
  blocked: "Blocked",
  resolved: "Resolved",
  rejected: "Rejected",
};

export const URGENCY_LABEL: Record<BriefUrgency, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  critical: "Critical",
};
