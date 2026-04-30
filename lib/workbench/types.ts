export type WorkbenchInvocationType = "preflight" | "presend";

export type WorkbenchTaskType =
  | "ask_decode"
  | "deck_scaffold"
  | "doc_scaffold"
  | "sheet_scaffold"
  | "draft_check"
  | "other";

export type WorkbenchDecodedTask = {
  summary: string;
  requester: string | null;
  deliverable_type: string | null;
  task_type: WorkbenchTaskType | string;
};

export type WorkbenchMissingContext = {
  question: string;
  why: string | null;
};

export type WorkbenchRetrievedContext = {
  claim: string;
  source_type: "notion" | "cornerstone" | "calendar" | "placeholder";
  source_label: string;
  source_url: string | null;
};

export type WorkbenchApproachStep = {
  step: string;
  rationale: string | null;
};

export type WorkbenchTimeEstimate = {
  estimated_before_minutes: number;
  estimated_workbench_minutes: number | null;
  task_type: WorkbenchTaskType | string;
};

export type WorkbenchPreflightResult = {
  decoded_task: WorkbenchDecodedTask;
  missing_context: WorkbenchMissingContext[];
  drafted_clarifying_message: string;
  retrieved_context: WorkbenchRetrievedContext[];
  suggested_approach: WorkbenchApproachStep[];
  time_estimate: WorkbenchTimeEstimate;
  warnings: string[];
};

export type WorkbenchInvocationLogRow = {
  user_id: string;
  invocation_type: WorkbenchInvocationType;
  task_type: WorkbenchTaskType | string;
  skill_name: string;
  skill_version: string | null;
  estimated_before_minutes: number;
  observed_after_minutes: number | null;
  latency_ms: number | null;
  ask_chars: number;
  status: "succeeded" | "failed";
  error: string | null;
  created_at: string;
};

export type WorkbenchStartResponse = {
  result: WorkbenchPreflightResult;
  invocation: WorkbenchInvocationLogRow;
  retrieval: {
    context: WorkbenchRetrievedContext[];
    statuses: Array<{
      source: "cornerstone" | "notion" | "calendar";
      status: "ok" | "unavailable" | "error";
      reason?: string;
      items_count: number;
    }>;
    sources?: Array<{
      source: "cornerstone" | "notion" | "calendar";
      status: "available" | "unavailable" | "error";
      items: WorkbenchRetrievedContext[];
      warnings: string[];
    }>;
    warnings?: string[];
    generated_at: string;
  };
  run_history?:
    | { status: "stored"; id: string; created_at: string }
    | { status: "unavailable"; reason: "workbench_run_history_unavailable" }
    | {
        status: "error";
        reason: "workbench_run_history_failed";
        detail: string;
      };
};
