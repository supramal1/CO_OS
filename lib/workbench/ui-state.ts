import type {
  WorkbenchWorkflowStage,
  WorkbenchWorkflowState,
} from "./workflow";

export type WorkbenchStaffConnectorSource =
  | "notion"
  | "drive"
  | "google"
  | "googleWorkspace"
  | "calendar";

export type WorkbenchStaffSetupState =
  | "loading"
  | "not_connected"
  | "ready"
  | "reauth_required"
  | "resource_missing"
  | "repair_available"
  | "unavailable"
  | "error";

export type WorkbenchPersonalisationConfig = {
  voice_register?: string | null;
  feedback_style?: string | null;
  friction_tasks?: string[] | null;
} | null;

export type WorkbenchPersonalisationSummary = {
  state: "setup_required" | "needs_profile" | "profile_ready";
  statusLabel: string;
  title: string;
  detail: string;
};

export type WorkbenchProfileUpdateInput =
  | null
  | undefined
  | {
      status:
        | "idle"
        | "pending"
        | "writing"
        | "updated"
        | "undone"
        | "skipped"
        | "error";
      targetLabel?: string | null;
      canUndo?: boolean | null;
      message?: string | null;
      reason?: string | null;
    };

export type WorkbenchProfileUpdateStatus = {
  state: "idle" | "updating" | "updated" | "undone" | "skipped" | "error";
  label: string;
  detail: string;
  actionLabel?: "Undo last profile update";
  actionDisabled?: boolean;
};

export type WorkbenchProfileLearningControl = {
  id: "view" | "undo" | "remember" | "not_now" | "edit";
  label: "View" | "Undo" | "Remember" | "Not now" | "Edit";
  enabled: boolean;
};

export type WorkbenchStageRow = {
  id: WorkbenchWorkflowStage["id"];
  label: string;
  state: WorkbenchWorkflowStage["status"];
  summary: string;
};

const DEFAULT_WORKBENCH_STAGE_ROWS: WorkbenchStageRow[] = [
  {
    id: "understand",
    label: "Understand",
    state: "available",
    summary: "Decode the task.",
  },
  {
    id: "gather",
    label: "Gather",
    state: "locked",
    summary: "Retrieve relevant context.",
  },
  {
    id: "make",
    label: "Make",
    state: "locked",
    summary: "Generate a first working artefact.",
  },
  {
    id: "review",
    label: "Review",
    state: "locked",
    summary: "Check quality before saving.",
  },
  {
    id: "save",
    label: "Save",
    state: "locked",
    summary: "Save the result back to the work environment.",
  },
];

export function deriveWorkbenchStageRows(
  workflow: WorkbenchWorkflowState | null | undefined,
): WorkbenchStageRow[] {
  if (!workflow?.stages?.length) return DEFAULT_WORKBENCH_STAGE_ROWS;
  return workflow.stages.map((stage) => ({
    id: stage.id,
    label: stage.label,
    state: stage.status,
    summary: stage.summary,
  }));
}

export function toStaffWorkbenchStatusLabel(
  source: WorkbenchStaffConnectorSource,
  state: WorkbenchStaffSetupState,
): string {
  if (state === "ready") return "Connected";
  if (state === "loading") return "Checking";
  if (state === "not_connected") return "Set up";
  if (state === "reauth_required") return "Needs reconnect";
  if (state === "resource_missing") {
    return source === "notion" ? "Repairing pages" : "Setting up workspace";
  }
  if (state === "repair_available") {
    return source === "notion" ? "Repairing pages" : "Needs reconnect";
  }
  if (state === "error") return "Check failed";
  return "Needs attention";
}

export function toStaffWorkbenchDetail(
  source: WorkbenchStaffConnectorSource,
  state: WorkbenchStaffSetupState,
  rawDetail?: string | null,
): string {
  if (state === "ready") return "Connected";
  if (state === "loading") return "Checking setup";
  if (state === "not_connected") return setupDetail(source);
  if (state === "reauth_required") return reconnectDetail(source);
  if (state === "resource_missing") return resourceDetail(source);
  if (state === "repair_available") return repairDetail(source);
  if (state === "error") return "Check setup";
  return sanitizeWorkbenchDetail(rawDetail, attentionDetail(source));
}

export function sanitizeWorkbenchDetail(
  value: string | null | undefined,
  fallback = "Check setup",
): string {
  const detail = value?.trim();
  if (!detail) return fallback;

  const lower = detail.toLowerCase();
  if (/notion|page|parent/.test(lower)) return "Repair Workbench pages";
  if (/google|oauth|token|scope|grant|refresh|calendar/.test(lower)) {
    return "Reconnect Google Workspace";
  }
  if (/drive|folder/.test(lower)) return "Set up Drive folder";
  if (/http\s*\d+|status\s*\d+|unauthori[sz]ed|invalid/.test(lower)) {
    return fallback;
  }
  if (/[a-z0-9]+_[a-z0-9_]+/.test(detail)) return fallback;

  return detail;
}

export function deriveWorkbenchPersonalisationSummary({
  setupReady,
  config,
}: {
  setupReady: boolean;
  config: WorkbenchPersonalisationConfig;
}): WorkbenchPersonalisationSummary {
  if (!setupReady) {
    return {
      state: "setup_required",
      statusLabel: "Setting up workspace",
      title: "Personalisation",
      detail: "Connect Notion and Google Workspace before personalisation.",
    };
  }

  if (hasProfileBasics(config)) {
    return {
      state: "profile_ready",
      statusLabel: "Connected",
      title: "Personalisation",
      detail: "Profile basics saved.",
    };
  }

  return {
    state: "needs_profile",
    statusLabel: "Needs profile",
    title: "Personalisation",
    detail: "Add short profile basics.",
  };
}

export function deriveWorkbenchProfileUpdateStatus(
  input: WorkbenchProfileUpdateInput,
): WorkbenchProfileUpdateStatus {
  if (!input || input.status === "idle") {
    return {
      state: "idle",
      label: "Profile learning",
      detail: "No profile updates from this run.",
    };
  }

  if (input.status === "pending" || input.status === "writing") {
    return {
      state: "updating",
      label: "Updating profile",
      detail: "Saving profile learning.",
    };
  }

  if (input.status === "updated") {
    const target = input.targetLabel?.trim();
    return {
      state: "updated",
      label: "Profile updated",
      detail: target ? `Updated ${target}.` : "Profile updated.",
      actionLabel: "Undo last profile update",
      actionDisabled: input.canUndo === false,
    };
  }

  if (input.status === "undone") {
    return {
      state: "undone",
      label: "Profile update undone",
      detail: "Last profile update was undone.",
    };
  }

  if (input.status === "skipped") {
    return {
      state: "skipped",
      label: "No profile update",
      detail: "No durable profile learning found.",
    };
  }

  return {
    state: "error",
    label: "Profile update paused",
    detail: sanitizeWorkbenchDetail(input.message, "Check profile update"),
  };
}

export function deriveWorkbenchProfileLearningControls(
  input: WorkbenchProfileUpdateInput,
): WorkbenchProfileLearningControl[] {
  if (!input || input.status === "idle") return [];

  if (input.status === "updated") {
    return [
      { id: "view", label: "View", enabled: true },
      { id: "undo", label: "Undo", enabled: input.canUndo !== false },
    ];
  }

  if (input.status === "skipped") {
    return [
      { id: "remember", label: "Remember", enabled: true },
      { id: "not_now", label: "Not now", enabled: true },
      { id: "edit", label: "Edit", enabled: true },
    ];
  }

  return [];
}

function setupDetail(source: WorkbenchStaffConnectorSource): string {
  if (source === "notion") return "Set up Notion";
  if (source === "drive") return "Set up Drive folder";
  if (source === "calendar") return "Connect Google Workspace";
  return "Connect Google Workspace";
}

function reconnectDetail(source: WorkbenchStaffConnectorSource): string {
  if (source === "notion") return "Reconnect Notion";
  return "Reconnect Google Workspace";
}

function resourceDetail(source: WorkbenchStaffConnectorSource): string {
  if (source === "notion") return "Repair Workbench pages";
  if (source === "drive") return "Set up Drive folder";
  if (source === "calendar") return "Reconnect Google Workspace";
  return "Set up Drive folder";
}

function repairDetail(source: WorkbenchStaffConnectorSource): string {
  if (source === "notion") return "Repair Workbench pages";
  return "Reconnect Google Workspace";
}

function attentionDetail(source: WorkbenchStaffConnectorSource): string {
  if (source === "notion") return "Check Notion setup";
  if (source === "drive") return "Check Drive setup";
  if (source === "calendar") return "Check Calendar setup";
  return "Check Google Workspace setup";
}

function hasProfileBasics(config: WorkbenchPersonalisationConfig): boolean {
  const voice = config?.voice_register?.trim();
  const feedback = config?.feedback_style?.trim();
  const frictionTasks = config?.friction_tasks?.filter((item) => item.trim());
  return Boolean(voice || feedback || (frictionTasks && frictionTasks.length > 0));
}
