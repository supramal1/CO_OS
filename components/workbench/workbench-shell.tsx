"use client";

import { signIn } from "next-auth/react";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import type {
  WorkbenchPreflightResult,
  WorkbenchStartResponse,
} from "@/lib/workbench/types";
import type {
  WorkbenchPresendResponse,
  WorkbenchPresendReviewedArtifact,
} from "@/lib/workbench/presend-types";
import type { WorkbenchOutputActionOutcome } from "@/lib/workbench/output-actions";
import type { WorkbenchOnboardingDraft } from "@/lib/workbench/personalisation";
import type { WorkbenchUserConfig } from "@/lib/workbench/retrieval/types";
import type {
  WorkbenchResumeAction,
  WorkbenchResumeSafeResult,
} from "@/lib/workbench/resume";
import type {
  WorkbenchArtifact,
  WorkbenchMakeResult,
} from "@/lib/workbench/make";
import type { WorkbenchReviewResult } from "@/lib/workbench/review";
import type { WorkbenchRunHistoryRow } from "@/lib/workbench/run-history";
import {
  deriveWorkbenchPersonalisationSummary,
  deriveWorkbenchProfileUpdateStatus,
  sanitizeWorkbenchDetail,
  toStaffWorkbenchDetail,
  toStaffWorkbenchStatusLabel,
  type WorkbenchProfileUpdateInput,
  type WorkbenchProfileUpdateStatus,
} from "@/lib/workbench/ui-state";
import {
  buildWorkbenchWorkflowState,
  type WorkbenchWorkflowState,
} from "@/lib/workbench/workflow";

type RunState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "loaded"; response: WorkbenchStartResponse }
  | { status: "error"; message: string };

type WorkbenchRetrievalRow = {
  source: string;
  label: string;
  status: string;
  itemsCount: number;
  reason: string | null;
  detail: string;
  warnings: string[];
};

type WorkbenchGoogleReadiness = {
  ready: boolean;
  status: string;
  required_scopes: string[];
  granted_scopes: string[];
  missing_scopes: string[];
  blockers: string[];
};

type WorkbenchConfigResponse = {
  config: WorkbenchStaffConfig | null;
  google_readiness: WorkbenchGoogleReadiness | null;
};

type WorkbenchStaffConfig = Omit<
  WorkbenchUserConfig,
  "google_oauth_grant_status" | "google_oauth_scopes"
> &
  Partial<Pick<WorkbenchUserConfig, "google_oauth_grant_status" | "google_oauth_scopes">>;

export type WorkbenchConfigForm = {
  notion_parent_page_id: string;
  drive_folder_id: string;
  drive_folder_url: string;
  voice_register: string;
  feedback_style: string;
  friction_tasks: string;
};

export type WorkbenchOnboardingForm = {
  role_title: string;
  current_focus_bullets: string;
  work_type_chips: string[];
  work_type_other: string;
  communication_style: string[];
  challenge_style: string[];
  helpful_context: string[];
  helpful_context_other: string;
};

type WorkbenchConfigPayload = {
  notion_parent_page_id: string;
  drive_folder_id: string;
  drive_folder_url: string;
  voice_register: string | null;
  feedback_style: string | null;
  friction_tasks: string[] | null;
};

export type WorkbenchConnectorState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | {
      status: "loaded";
      config: WorkbenchStaffConfig | null;
      google_readiness: WorkbenchGoogleReadiness | null;
    };

type WorkbenchConnectorRow = {
  id: "notion" | "drive" | "google" | "calendar";
  label: string;
  status: "ready" | "loading" | "unavailable" | "error";
  detail: string;
  action?: "google_reconsent";
};

type WorkbenchConnectorSummary = {
  overallStatus: "ready" | "loading" | "unavailable" | "error";
  rows: WorkbenchConnectorRow[];
};

type WorkbenchCheckResponse = {
  checks: Array<{
    source?: string;
    name?: string;
    status: string;
    reason?: string;
    message?: string;
    blockers?: string[];
    action?: "google_reconsent";
    items_count?: number;
  }>;
  generated_at: string;
};

type WorkbenchHealthRow = {
  source: string;
  status: string;
  itemsCount: number;
  reason: string | null;
};

type WorkbenchSetupConnectorState =
  | "loading"
  | "not_connected"
  | "ready"
  | "reauth_required"
  | "resource_missing"
  | "repair_available"
  | "unavailable"
  | "error";

type WorkbenchSetupAction = "notion_start" | "google_sign_in";
type WorkbenchConnectorManagementSource = "notion" | "google_workspace";
type WorkbenchConnectorManagementActionType = "repair" | "disconnect";

type WorkbenchConnectorManagementAction = {
  id: string;
  label: string;
  source: WorkbenchConnectorManagementSource;
  endpoint: `/api/workbench/connectors/${WorkbenchConnectorManagementSource}`;
  method: "POST";
  payload: { action: WorkbenchConnectorManagementActionType };
};

type WorkbenchSetupAffordance = {
  id: "notion" | "googleWorkspace";
  label: string;
  state: WorkbenchSetupConnectorState;
  statusLabel: string;
  detail: string;
  buttonLabel: string;
  action: WorkbenchSetupAction;
  href?: string;
  callbackUrl?: string;
  disabled?: boolean;
};

type WorkbenchSetupAffordanceSummary = {
  notion: WorkbenchSetupAffordance;
  googleWorkspace: WorkbenchSetupAffordance;
  manualConfig: {
    summaryLabel: string;
    secondaryLabel: string;
    initiallyOpen: boolean;
  };
};

type WorkbenchSetupSummary = {
  state: "loading" | "needs_setup" | "repairing" | "ready" | "error" | "unavailable";
  label: string;
  detail: string;
};

type WorkbenchOAuthNotice = {
  tone: "info" | "error";
  label: string;
  detail: string;
};

type WorkbenchRunPaneSummary = {
  tone: "idle" | "loading" | "error";
  label: string;
  title: string;
  detail: string;
};

type WorkbenchWizardStepId = "setup" | "context" | "generate" | "review";

type WorkbenchWizardStep = {
  id: WorkbenchWizardStepId;
  label: string;
  caption: string;
};

type WorkbenchStageRow = {
  id: "understand" | "gather" | "make" | "review" | "save";
  label: string;
  state: "complete" | "active" | "available" | "locked" | "error";
  summary: string;
};

type WorkbenchPostRunAction =
  | {
      id: "presend";
      label: string;
      detail: string;
      status: "ready";
      endpoint: "/api/workbench/presend";
      method: "POST";
      payload: {
        preflight_result: WorkbenchPreflightResult;
        artifact_spec_input: string;
        reviewed_artifact?: WorkbenchPresendReviewedArtifact;
      };
    }
  | {
      id: "presend";
      label: string;
      detail: string;
      status: "disabled";
      disabledReason: string;
    }
  | {
      id: "feedback_useful" | "feedback_not_useful";
      label: string;
      detail: string;
      status: "ready";
      endpoint: "/api/workbench/actions";
      method: "POST";
      payload: {
        action: "feedback_useful" | "feedback_not_useful";
        run_id?: string;
        payload: {
          task_type: string;
          source_count: number;
          warning_count: number;
        };
      };
    };

type SetupState =
  | { status: "idle" }
  | { status: "saving" }
  | { status: "saved" }
  | { status: "checking" }
  | { status: "error"; message: string };

type WorkbenchOnboardingState =
  | { status: "idle" }
  | { status: "drafting" }
  | { status: "drafted"; draft: WorkbenchOnboardingDraft }
  | { status: "saving"; draft: WorkbenchOnboardingDraft }
  | { status: "saved"; message: string }
  | { status: "error"; message: string };

type PostRunState =
  | { status: "idle" }
  | { status: "running"; actionId: WorkbenchPostRunAction["id"] }
  | {
      status: "loaded";
      actionId: WorkbenchPostRunAction["id"];
      message: string;
      href?: string;
    }
  | { status: "error"; actionId: WorkbenchPostRunAction["id"]; message: string };

type WorkbenchWizardAction = {
  label: string;
  onClick?: () => void;
  disabled?: boolean;
};

type ContextResumeState =
  | { status: "idle" }
  | { status: "running"; action: WorkbenchResumeAction }
  | { status: "loaded"; resume: WorkbenchResumeSafeResult }
  | { status: "error"; action: WorkbenchResumeAction; message: string };

type MakeState =
  | { status: "idle" }
  | { status: "running" }
  | { status: "loaded"; result: Extract<WorkbenchMakeResult, { status: "drafted" }> }
  | { status: "error"; message: string };

type ReviewState =
  | { status: "idle" }
  | { status: "running" }
  | { status: "loaded"; result: WorkbenchReviewResult }
  | { status: "error"; message: string };

type WorkbenchResumeRouteResponse =
  | { resume: WorkbenchResumeSafeResult }
  | { error?: string; detail?: string };

type WorkbenchRunHistoryDisplayRow = {
  id: string;
  createdLabel: string;
  askSnippet: string;
  status: WorkbenchStartResponse["invocation"]["status"];
  countLabel: string;
};

type WorkbenchRunHistoryState =
  | { status: "loading" }
  | { status: "loaded"; runs: WorkbenchRunHistoryRow[] }
  | { status: "error"; message: string };

type WorkbenchRunHistoryListResponse =
  | { runs: WorkbenchRunHistoryRow[] }
  | { error?: string; detail?: string; runs?: [] };

type WorkbenchConnectorManagementState =
  | { status: "idle" }
  | { status: "running"; actionId: string }
  | { status: "loaded"; actionId: string; message: string }
  | { status: "error"; actionId: string; message: string };

const CALENDAR_READONLY_SCOPE =
  "https://www.googleapis.com/auth/calendar.readonly";
const NOTION_SETUP_HREF = "/api/workbench/notion/start";
const GOOGLE_SETUP_HREF = "/workbench?google_oauth=start";
const WORKBENCH_CALLBACK_URL = "/workbench?google_oauth=returned";
const WORKBENCH_PRESEND_ROUTE_AVAILABLE = true;

const WORKBENCH_WIZARD_STEPS: WorkbenchWizardStep[] = [
  { id: "setup", label: "Setup", caption: "Connect and start" },
  { id: "context", label: "Context", caption: "Fill the gaps" },
  { id: "generate", label: "Generate", caption: "Create the draft" },
  { id: "review", label: "Review", caption: "Refine and ship" },
];

const CONNECTOR_LABELS: Array<Pick<WorkbenchConnectorRow, "id" | "label">> = [
  { id: "notion", label: "Notion" },
  { id: "drive", label: "Drive" },
  { id: "google", label: "Google Workspace" },
  { id: "calendar", label: "Calendar" },
];

const EMPTY_CONFIG_FORM: WorkbenchConfigForm = {
  notion_parent_page_id: "",
  drive_folder_id: "",
  drive_folder_url: "",
  voice_register: "",
  feedback_style: "",
  friction_tasks: "",
};

const WORKBENCH_WORK_TYPE_OPTIONS = [
  "Client responses",
  "Decks",
  "Research",
  "Strategy",
  "Status updates",
  "Meeting prep",
  "QA / review",
  "Data / sheets",
  "Stakeholder comms",
  "Process docs",
] as const;

const WORKBENCH_COMMUNICATION_STYLE_OPTIONS = [
  "Concise",
  "Direct",
  "Polished",
  "Source-led",
  "Action-oriented",
  "Detailed when needed",
  "Client-ready",
] as const;

const WORKBENCH_CHALLENGE_STYLE_OPTIONS = [
  "Flag weak logic",
  "Challenge assumptions",
  "Suggest stronger framing",
  "Point out missing context",
  "Be direct",
  "Show risks/tradeoffs",
] as const;

const WORKBENCH_HELPFUL_CONTEXT_OPTIONS = [
  "New to this account/project",
  "Need source links",
  "Working across multiple clients",
  "Often preparing client-ready outputs",
  "Prefer short next steps",
  "Tight turnaround work",
] as const;

const GOOGLE_CONNECT_STATUSES = new Set([
  "grant_missing",
  "scope_missing",
  "token_missing",
  "token_lookup_unavailable",
]);

const GOOGLE_REAUTH_STATUSES = new Set(["scope_missing"]);
const GOOGLE_REPAIR_STATUSES = new Set([
  "token_missing",
  "token_lookup_unavailable",
]);
const GOOGLE_RESOURCE_MISSING_STATUSES = new Set(["config_missing"]);

export function getInitialWorkbenchConfigForm(
  config: WorkbenchStaffConfig | null | undefined,
): WorkbenchConfigForm {
  if (!config) return { ...EMPTY_CONFIG_FORM };
  return {
    notion_parent_page_id: config.notion_parent_page_id ?? "",
    drive_folder_id: config.drive_folder_id ?? "",
    drive_folder_url: config.drive_folder_url ?? "",
    voice_register: config.voice_register ?? "",
    feedback_style: config.feedback_style ?? "",
    friction_tasks: (config.friction_tasks ?? []).join("\n "),
  };
}

export function buildWorkbenchConfigPayload(
  form: WorkbenchConfigForm,
): WorkbenchConfigPayload {
  const frictionTasks = form.friction_tasks
    .split(/[\n,]/)
    .map((item) => item.trim())
    .filter(Boolean);

  return {
    notion_parent_page_id: form.notion_parent_page_id.trim(),
    drive_folder_id: form.drive_folder_id.trim(),
    drive_folder_url: form.drive_folder_url.trim(),
    voice_register: optionalFormString(form.voice_register),
    feedback_style: optionalFormString(form.feedback_style),
    friction_tasks: frictionTasks.length > 0 ? frictionTasks : null,
  };
}

export function buildWorkbenchOnboardingPayload(
  form: WorkbenchOnboardingForm,
  configForm: Pick<
    WorkbenchConfigForm,
    "voice_register" | "feedback_style" | "friction_tasks"
  >,
) {
  const workTypes = dedupeWorkbenchStrings([
    ...form.work_type_chips,
    form.work_type_other,
  ]);
  const communicationStyle =
    form.communication_style.length > 0
      ? form.communication_style
      : splitWorkbenchLines(configForm.voice_register);
  const challengeStyle =
    form.challenge_style.length > 0
      ? form.challenge_style
      : splitWorkbenchLines(configForm.feedback_style);

  return {
    role_title: form.role_title.trim(),
    current_focus_bullets: splitWorkbenchLines(form.current_focus_bullets),
    work_type_chips:
      workTypes.length > 0
        ? workTypes
        : splitWorkbenchLines(configForm.friction_tasks),
    communication_style: communicationStyle,
    challenge_style: challengeStyle,
    helpful_context: dedupeWorkbenchStrings([
      ...form.helpful_context,
      form.helpful_context_other,
    ]),
  };
}

export function hasWorkbenchProfileSeed(
  config: WorkbenchStaffConfig | null | undefined,
): boolean {
  return Boolean(
    config?.notion_parent_page_id?.trim() ||
      config?.voice_register?.trim() ||
      config?.feedback_style?.trim() ||
      config?.friction_tasks?.some((item) => item.trim()),
  );
}

export function shouldShowGoogleConnect(
  readiness: Pick<WorkbenchGoogleReadiness, "ready" | "status"> | null | undefined,
) {
  return Boolean(
    readiness &&
      !readiness.ready &&
      GOOGLE_CONNECT_STATUSES.has(readiness.status),
  );
}

export function toWorkbenchHealthRows(
  response: WorkbenchCheckResponse | null | undefined,
): WorkbenchHealthRow[] {
  return (response?.checks ?? []).map((check) => ({
    source: check.source ?? check.name ?? "unknown",
    status: check.status,
    itemsCount: check.items_count ?? 0,
    reason:
      check.reason ??
      check.message ??
      check.blockers?.filter(Boolean).join("; ") ??
      null,
  }));
}

export function deriveWorkbenchSetupAffordances({
  connectorState,
  healthRows,
}: {
  connectorState: WorkbenchConnectorState;
  healthRows: WorkbenchHealthRow[];
}): WorkbenchSetupAffordanceSummary {
  return {
    notion: deriveNotionSetupAffordance(connectorState, healthRows),
    googleWorkspace: deriveGoogleWorkspaceSetupAffordance(connectorState),
    manualConfig: {
      summaryLabel: "Manual connector fields",
      secondaryLabel: "Debug only",
      initiallyOpen: false,
    },
  };
}

export function deriveWorkbenchSetupSummary(
  affordances: WorkbenchSetupAffordanceSummary,
): WorkbenchSetupSummary {
  const connectors = [affordances.notion, affordances.googleWorkspace];
  if (connectors.some((connector) => connector.state === "loading")) {
    return {
      state: "loading",
      label: "Setting up workspace",
      detail: "Checking workspace setup.",
    };
  }

  if (connectors.some((connector) => connector.state === "error")) {
    return {
      state: "error",
      label: "Check failed",
      detail: "Check setup before running Workbench.",
    };
  }

  if (connectors.every((connector) => connector.state === "ready")) {
    return {
      state: "ready",
      label: "Connected",
      detail: "Workbench workspace is connected.",
    };
  }

  const needsConnection = connectors.filter(
    (connector) => connector.state === "not_connected",
  );
  if (needsConnection.length > 0) {
    return {
      state: "needs_setup",
      label: "Setting up workspace",
      detail: `Connect ${formatConnectorList(
        needsConnection.map((connector) => connector.label),
      )} before running with staff context.`,
    };
  }

  const repairable = connectors.filter((connector) =>
    ["reauth_required", "resource_missing", "repair_available"].includes(
      connector.state,
    ),
  );
  if (repairable.length > 0) {
    const hasNotionRepair = repairable.some((connector) => connector.id === "notion");
    return {
      state: "repairing",
      label: hasNotionRepair ? "Repairing pages" : "Needs reconnect",
      detail: formatRepairSetupDetail(repairable),
    };
  }

  return {
    state: "unavailable",
    label: "Needs attention",
    detail: "Check connectors before running Workbench.",
  };
}

export function deriveWorkbenchOAuthNotice(
  search: string | URLSearchParams | null | undefined,
): WorkbenchOAuthNotice | null {
  const params = toSearchParams(search);
  if (!params) return null;

  if (params.get("google_oauth") === "start") {
    return {
      tone: "info",
      label: "Connecting Google Workspace",
      detail: "Opening Google Workspace consent.",
    };
  }

  if (params.get("notion_setup") === "failed") {
    return {
      tone: "error",
      label: "Notion setup needs repair",
      detail: sanitizeWorkbenchDetail(
        params.get("reason"),
        "Repair Workbench pages",
      ),
    };
  }

  if (params.get("notion_setup") === "connected") {
    return {
      tone: "info",
      label: "Notion connected",
      detail: "Workbench pages are ready.",
    };
  }

  if (params.get("google_oauth") === "returned") {
    return {
      tone: "info",
      label: "Google Workspace connected",
      detail: "Checking saved access.",
    };
  }

  const oauthError = params.get("error");
  if (oauthError) {
    return {
      tone: "error",
      label: "Connection was not completed",
      detail: sanitizeWorkbenchDetail(
        params.get("error_description") || oauthError,
        "Check setup",
      ),
    };
  }

  return null;
}

function isGoogleOAuthStartUrl(value: string): boolean {
  try {
    const url = new URL(value, window.location.origin);
    return (
      url.pathname === "/workbench" &&
      url.searchParams.get("google_oauth") === "start"
    );
  } catch {
    return value === GOOGLE_SETUP_HREF;
  }
}

function deriveNotionSetupAffordance(
  connectorState: WorkbenchConnectorState,
  healthRows: WorkbenchHealthRow[],
): WorkbenchSetupAffordance {
  const base = {
    id: "notion" as const,
    label: "Notion",
    buttonLabel: "Repair Notion",
    action: "notion_start" as const,
    href: NOTION_SETUP_HREF,
  };

  if (connectorState.status === "loading") {
    return {
      ...base,
      state: "loading",
      statusLabel: toStaffWorkbenchStatusLabel("notion", "loading"),
      detail: toStaffWorkbenchDetail("notion", "loading"),
      disabled: true,
    };
  }

  if (connectorState.status === "error") {
    return {
      ...base,
      state: "error",
      statusLabel: toStaffWorkbenchStatusLabel("notion", "error"),
      detail: toStaffWorkbenchDetail("notion", "error", connectorState.message),
    };
  }

  const notionParentPageId =
    connectorState.config?.notion_parent_page_id?.trim() ?? "";

  if (!notionParentPageId) {
    return {
      ...base,
      state: "not_connected",
      statusLabel: toStaffWorkbenchStatusLabel("notion", "not_connected"),
      detail: toStaffWorkbenchDetail("notion", "not_connected"),
      buttonLabel: "Set up Notion",
    };
  }

  const health = healthRows.find((row) => row.source === "notion");
  if (health) {
    const healthState = deriveResourceHealthState(health);
    if (healthState !== "ready") {
      return {
        ...base,
        state: healthState,
        statusLabel: toStaffWorkbenchStatusLabel("notion", healthState),
        detail: toStaffWorkbenchDetail("notion", healthState, health.reason),
      };
    }
  }

  return {
    ...base,
    state: "ready",
    statusLabel: toStaffWorkbenchStatusLabel("notion", "ready"),
    detail: toStaffWorkbenchDetail("notion", "ready"),
    buttonLabel: "Connected",
    disabled: true,
  };
}

function deriveGoogleWorkspaceSetupAffordance(
  connectorState: WorkbenchConnectorState,
): WorkbenchSetupAffordance {
  const base = {
    id: "googleWorkspace" as const,
    label: "Google Workspace",
    buttonLabel: "Repair Google Workspace",
    action: "google_sign_in" as const,
    callbackUrl: WORKBENCH_CALLBACK_URL,
  };

  if (connectorState.status === "loading") {
    return {
      ...base,
      state: "loading",
      statusLabel: toStaffWorkbenchStatusLabel("googleWorkspace", "loading"),
      detail: toStaffWorkbenchDetail("googleWorkspace", "loading"),
      buttonLabel: "Connect Google Workspace",
      disabled: true,
    };
  }

  if (connectorState.status === "error") {
    return {
      ...base,
      state: "error",
      statusLabel: toStaffWorkbenchStatusLabel("googleWorkspace", "error"),
      detail: toStaffWorkbenchDetail(
        "googleWorkspace",
        "error",
        connectorState.message,
      ),
    };
  }

  const driveFolderId = connectorState.config?.drive_folder_id?.trim() ?? "";
  const readiness = connectorState.google_readiness;
  if (!readiness) {
    return {
      ...base,
      state: "unavailable",
      statusLabel: toStaffWorkbenchStatusLabel("googleWorkspace", "unavailable"),
      detail: toStaffWorkbenchDetail("googleWorkspace", "unavailable"),
    };
  }

  if (readiness.ready) {
    if (!driveFolderId) {
      return {
        ...base,
        state: "resource_missing",
        statusLabel: toStaffWorkbenchStatusLabel(
          "googleWorkspace",
          "resource_missing",
        ),
        detail: toStaffWorkbenchDetail(
          "googleWorkspace",
          "resource_missing",
          "drive_folder_id missing",
        ),
        buttonLabel: "Set up workspace",
      };
    }
    return {
      ...base,
      state: "ready",
      statusLabel: toStaffWorkbenchStatusLabel("googleWorkspace", "ready"),
      detail: toStaffWorkbenchDetail("googleWorkspace", "ready"),
      buttonLabel: "Connected",
      disabled: true,
    };
  }

  const detail = firstDetail(
    readiness.blockers,
    readiness.missing_scopes,
    readiness.status,
  );

  if (readiness.status === "grant_missing") {
    return {
      ...base,
      state: "not_connected",
      statusLabel: toStaffWorkbenchStatusLabel(
        "googleWorkspace",
        "not_connected",
      ),
      detail: toStaffWorkbenchDetail("googleWorkspace", "not_connected", detail),
      buttonLabel: "Connect Google Workspace",
    };
  }

  const state = GOOGLE_REAUTH_STATUSES.has(readiness.status)
    ? "reauth_required"
    : GOOGLE_RESOURCE_MISSING_STATUSES.has(readiness.status)
      ? "resource_missing"
      : GOOGLE_REPAIR_STATUSES.has(readiness.status)
        ? "repair_available"
        : "unavailable";

  return {
    ...base,
    state,
    statusLabel: toStaffWorkbenchStatusLabel("googleWorkspace", state),
    detail: toStaffWorkbenchDetail("googleWorkspace", state, detail),
    buttonLabel:
      state === "resource_missing"
        ? "Set up workspace"
        : "Reconnect Google Workspace",
  };
}

function deriveResourceHealthState(
  row: WorkbenchHealthRow,
): Exclude<WorkbenchSetupConnectorState, "loading" | "not_connected" | "reauth_required"> {
  if (["ready", "ok", "available"].includes(row.status)) {
    return "ready";
  }
  if (row.status === "error") return "error";
  if (row.status === "resource_missing") return "resource_missing";
  if (/\b(missing|not_found|not found)\b/i.test(row.reason ?? "")) {
    return "resource_missing";
  }
  if (row.status === "unavailable") return "repair_available";
  return "unavailable";
}

export function deriveWorkbenchConnectorSummary(
  state: WorkbenchConnectorState,
): WorkbenchConnectorSummary {
  if (state.status === "loading") {
    return {
      overallStatus: "loading",
      rows: CONNECTOR_LABELS.map((row) => ({
        ...row,
        status: "loading",
        detail: "Checking setup",
      })),
    };
  }

  if (state.status === "error") {
    return {
      overallStatus: "error",
      rows: CONNECTOR_LABELS.map((row) => ({
        ...row,
        status: "error",
        detail: sanitizeWorkbenchDetail(state.message, "Check setup"),
      })),
    };
  }

  const config = state.config;
  const googleReadiness = state.google_readiness;
  const notionParentPageId = config?.notion_parent_page_id?.trim() ?? "";
  const driveFolderId = config?.drive_folder_id?.trim() ?? "";
  const googleDetail =
    googleReadiness?.status ??
    config?.google_oauth_grant_status?.trim() ??
    "google_readiness unavailable";
  const googleSetupState = deriveGoogleSetupState(googleReadiness);
  const calendarReady =
    Boolean(googleReadiness?.ready) &&
    (googleReadiness?.granted_scopes ?? []).includes(CALENDAR_READONLY_SCOPE);
  const calendarDetail = calendarReady
    ? toStaffWorkbenchDetail("calendar", "ready")
    : toStaffWorkbenchDetail(
        "calendar",
        googleSetupState,
        firstDetail(
          googleReadiness?.blockers,
          googleReadiness?.missing_scopes,
          googleDetail,
        ),
      );
  const googleAction = shouldShowGoogleConnect(googleReadiness)
    ? "google_reconsent"
    : undefined;

  const rows: WorkbenchConnectorRow[] = [
    {
      id: "notion",
      label: "Notion",
      status: notionParentPageId ? "ready" : "unavailable",
      detail: notionParentPageId
        ? toStaffWorkbenchDetail("notion", "ready")
        : toStaffWorkbenchDetail("notion", "not_connected"),
    },
    {
      id: "drive",
      label: "Drive",
      status: driveFolderId ? "ready" : "unavailable",
      detail: driveFolderId
        ? toStaffWorkbenchDetail("drive", "ready")
        : toStaffWorkbenchDetail("drive", "not_connected"),
    },
    {
      id: "google",
      label: "Google Workspace",
      status: googleReadiness?.ready ? "ready" : "unavailable",
      detail: googleReadiness?.ready
        ? toStaffWorkbenchDetail("googleWorkspace", "ready")
        : toStaffWorkbenchDetail("googleWorkspace", googleSetupState, googleDetail),
      action: googleAction,
    },
    {
      id: "calendar",
      label: "Calendar",
      status: calendarReady ? "ready" : "unavailable",
      detail: calendarDetail,
      action: calendarReady ? undefined : googleAction,
    },
  ];

  return {
    overallStatus: rows.every((row) => row.status === "ready")
      ? "ready"
      : "unavailable",
    rows,
  };
}

export function deriveWorkbenchUiSummary(response: WorkbenchStartResponse) {
  const result = response.result;
  const retrieval = response.retrieval;
  const workflow = readWorkbenchWorkflow(response);
  const beforeMinutes =
    result.time_estimate.estimated_before_minutes ||
    response.invocation.estimated_before_minutes;
  const workbenchMinutes = result.time_estimate.estimated_workbench_minutes;
  const savedMinutes =
    workbenchMinutes == null ? null : Math.max(0, beforeMinutes - workbenchMinutes);
  const sourceCount = result.retrieved_context.length;
  const retrievalRows = deriveRetrievalRows(response);
  const warningCount =
    result.warnings.length + (retrieval.warnings ? retrieval.warnings.length : 0);

  return {
    invocationState: response.invocation.status,
    sourceCount,
    baselineLabel: `${beforeMinutes}m baseline`,
    workbenchLabel:
      workbenchMinutes == null ? "Workbench time pending" : `${workbenchMinutes}m with Workbench`,
    hoursSavedLabel:
      savedMinutes == null ? "Savings pending" : `${(savedMinutes / 60).toFixed(1)}h saved`,
    warningCount,
    retrievalRows,
    currentStage: workflow.current_stage,
    missingContextCount: workflow.missing_required_context_count,
  };
}

export function deriveWorkbenchRunPaneSummary(
  state: Pick<RunState, "status"> & { message?: string },
): WorkbenchRunPaneSummary {
  if (state.status === "loading") {
    return {
      tone: "loading",
      label: "Running",
      title: "Workbench is running",
      detail: "Retrieving context and preparing the task output.",
    };
  }

  if (state.status === "error") {
    return {
      tone: "error",
      label: "Run failed",
      title: "API error",
      detail: state.message || "Unknown Workbench API error.",
    };
  }

  return {
    tone: "idle",
    label: "Ready",
    title: "Ready to start",
    detail: "Paste what you are working on and start Workbench.",
  };
}

export function deriveWorkbenchPostRunActions(
  response: WorkbenchStartResponse,
  options?: {
    presendRouteAvailable?: boolean;
    reviewedArtifact?: WorkbenchPresendReviewedArtifact | null;
    requireReviewedArtifact?: boolean;
  },
): WorkbenchPostRunAction[] {
  const presendRouteAvailable =
    options?.presendRouteAvailable ?? WORKBENCH_PRESEND_ROUTE_AVAILABLE;
  const feedbackActions = buildWorkbenchFeedbackActions(response);
  const reviewedArtifact = options?.reviewedArtifact ?? null;

  if (!presendRouteAvailable) {
    return [
      {
        id: "presend",
        label: "Prepare save-back artifact",
        detail: "Pre-send save-back is not available in this build.",
        status: "disabled",
        disabledReason: "presend_route_unavailable",
      },
      ...feedbackActions,
    ];
  }

  if (options?.requireReviewedArtifact && !reviewedArtifact) {
    return [
      {
        id: "presend",
        label: "Save reviewed draft",
        detail: "Generate and review a draft before saving it.",
        status: "disabled",
        disabledReason: "review_required",
      },
      ...feedbackActions,
    ];
  }

  return [
    {
      id: "presend",
      label: reviewedArtifact ? "Save reviewed draft" : "Prepare save-back artifact",
      detail:
        "Run final checks and save the work to Drive when required.",
      status: "ready",
      endpoint: "/api/workbench/presend",
      method: "POST",
      payload: {
        preflight_result: response.result,
        artifact_spec_input: buildWorkbenchPostRunArtifactSpecInput(response),
        ...(reviewedArtifact ? { reviewed_artifact: reviewedArtifact } : {}),
      },
    },
    ...feedbackActions,
  ];
}

export function deriveWorkbenchRunHistoryRows(
  runs: WorkbenchRunHistoryRow[],
  options?: {
    formatCreatedAt?: (value: string) => string;
    askSnippetLength?: number;
  },
): WorkbenchRunHistoryDisplayRow[] {
  const formatCreatedAt = options?.formatCreatedAt ?? formatCompactDate;
  const askSnippetLength = options?.askSnippetLength ?? 72;

  return runs.map((run) => {
    const warningCount = dedupeWarnings([
      ...run.result.warnings,
      ...(run.retrieval.warnings ?? []),
    ]).length;
    const sourceCount = run.result.retrieved_context.length;

    return {
      id: run.id,
      createdLabel: formatCreatedAt(run.created_at),
      askSnippet: truncateSnippet(run.ask, askSnippetLength),
      status: run.invocation.status,
      countLabel:
        warningCount > 0
          ? pluralize(warningCount, "warning")
          : pluralize(sourceCount, "source"),
    };
  });
}

export function toWorkbenchStartResponseFromHistoryRun(
  run: WorkbenchRunHistoryRow,
): WorkbenchStartResponse {
  return {
    result: run.result,
    workflow: buildWorkbenchWorkflowState(run.result),
    retrieval: run.retrieval,
    invocation: run.invocation,
    run_history: {
      status: "stored",
      id: run.id,
      created_at: run.created_at,
    },
  };
}

export function deriveWorkbenchConnectorManagementActions(
  affordance: WorkbenchSetupAffordance,
): WorkbenchConnectorManagementAction[] {
  const source = connectorManagementSourceForSetupAffordance(affordance);
  if (!source) return [];

  const actions: WorkbenchConnectorManagementAction[] = [];
  if (
    ["reauth_required", "resource_missing", "repair_available"].includes(
      affordance.state,
    )
  ) {
    actions.push(buildConnectorManagementAction(source, "repair"));
  }

  if (affordance.state === "ready") {
    actions.push(buildConnectorManagementAction(source, "disconnect"));
  }

  return actions;
}

function buildConnectorManagementAction(
  source: WorkbenchConnectorManagementSource,
  action: WorkbenchConnectorManagementActionType,
): WorkbenchConnectorManagementAction {
  return {
    id: `${source}-${action}`,
    label: action === "repair" ? "Repair" : "Disconnect",
    source,
    endpoint: `/api/workbench/connectors/${source}`,
    method: "POST",
    payload: { action },
  };
}

function deriveRetrievalRows(
  response: WorkbenchStartResponse,
): WorkbenchRetrievalRow[] {
  const statusesBySource = new Map(
    response.retrieval.statuses.map((status) => [status.source, status]),
  );

  if (response.retrieval.sources?.length) {
    return response.retrieval.sources.map((source) => {
      const status = statusesBySource.get(source.source);
      const rawDetail = [status?.reason, ...source.warnings]
        .filter(Boolean)
        .join(" | ");
      return {
        source: source.source,
        label: retrievalSourceLabel(source.source),
        status: source.status,
        itemsCount: source.items.length,
        reason: status?.reason ?? null,
        detail: retrievalDetail(source.source, source.status, rawDetail),
        warnings: source.warnings.map((warning) =>
          retrievalDetail(source.source, source.status, warning),
        ),
      };
    });
  }

  return response.retrieval.statuses.map((status) => ({
    source: status.source,
    label: retrievalSourceLabel(status.source),
    status: status.status,
    itemsCount: status.items_count,
    reason: status.reason ?? null,
    detail: retrievalDetail(status.source, status.status, status.reason),
    warnings: [],
  }));
}

function retrievalSourceLabel(source: WorkbenchRetrievalRow["source"]): string {
  if (source === "cornerstone") return "Cornerstone";
  if (source === "notion") return "Notion";
  if (source === "calendar") return "Calendar";
  return source;
}

function retrievalDetail(
  source: WorkbenchRetrievalRow["source"],
  status: string,
  rawDetail?: string | null,
): string {
  if (status === "available" || status === "ok") return "Connected";
  if (source === "notion") {
    return sanitizeWorkbenchDetail(rawDetail, "Repair Workbench pages");
  }
  if (source === "calendar") {
    return sanitizeWorkbenchDetail(rawDetail, "Reconnect Google Workspace");
  }
  if (source === "cornerstone") {
    return sanitizeWorkbenchDetail(rawDetail, "Check memory connection");
  }
  return sanitizeWorkbenchDetail(rawDetail, "Check setup");
}

export function WorkbenchShell() {
  const [ask, setAsk] = useState("");
  const [state, setState] = useState<RunState>({ status: "idle" });
  const [connectorState, setConnectorState] =
    useState<WorkbenchConnectorState>({ status: "loading" });
  const [runHistoryState, setRunHistoryState] =
    useState<WorkbenchRunHistoryState>({ status: "loading" });
  const [wizardStep, setWizardStep] =
    useState<WorkbenchWizardStepId>("setup");

  const canSubmit = ask.trim().length > 0 && state.status !== "loading";
  const loadedResponse = state.status === "loaded" ? state.response : null;
  const selectedRunId =
    loadedResponse?.run_history?.status === "stored"
      ? loadedResponse.run_history.id
      : null;
  const setupAffordances = useMemo(
    () => deriveWorkbenchSetupAffordances({ connectorState, healthRows: [] }),
    [connectorState],
  );
  const setupSummary = useMemo(
    () => deriveWorkbenchSetupSummary(setupAffordances),
    [setupAffordances],
  );
  const runPaneSummary = useMemo(
    () => deriveWorkbenchRunPaneSummary(state),
    [state],
  );
  const loadedUiSummary = useMemo(
    () => (loadedResponse ? deriveWorkbenchUiSummary(loadedResponse) : null),
    [loadedResponse],
  );
  const loadedProfileUpdateStatus = useMemo(
    () =>
      loadedResponse
        ? deriveWorkbenchProfileUpdateStatus(
            readWorkbenchProfileUpdate(loadedResponse),
          )
        : null,
    [loadedResponse],
  );
  const setupProfileSummary = useMemo(
    () =>
      deriveWorkbenchPersonalisationSummary({
        setupReady: setupSummary.state === "ready",
        config: connectorState.status === "loaded" ? connectorState.config : null,
      }),
    [connectorState, setupSummary.state],
  );

  const loadConfig = useCallback(async (options?: { silent?: boolean }) => {
    if (!options?.silent) {
      setConnectorState({ status: "loading" });
    }
    try {
      const res = await fetch("/api/workbench/config", {
        method: "GET",
        headers: { Accept: "application/json" },
      });
      const body = (await res.json().catch(() => null)) as
        | WorkbenchConfigResponse
        | { error?: string; detail?: string }
        | null;

      if (!res.ok) {
        const detail =
          body && "detail" in body && body.detail
            ? body.detail
            : body && "error" in body && body.error
              ? body.error
              : `HTTP ${res.status}`;
        throw new Error(detail);
      }

      const payload = body as WorkbenchConfigResponse | null;
      const config = payload?.config ?? null;
      setConnectorState({
        status: "loaded",
        config,
        google_readiness: payload?.google_readiness ?? null,
      });
    } catch (err) {
      setConnectorState({
        status: "error",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadInitialConfig() {
      if (!cancelled) await loadConfig();
    }

    loadInitialConfig();

    return () => {
      cancelled = true;
    };
  }, [loadConfig]);

  useEffect(() => {
    const search = window.location.search;
    if (isGoogleOAuthStartUrl(`${window.location.pathname}${search}`)) {
      window.history.replaceState(null, "", "/workbench");
      void signIn("google", { callbackUrl: WORKBENCH_CALLBACK_URL });
    }
  }, []);

  const loadRunHistory = useCallback(async (options?: { silent?: boolean }) => {
    if (!options?.silent) {
      setRunHistoryState({ status: "loading" });
    }

    try {
      const res = await fetch("/api/workbench/runs?limit=5", {
        method: "GET",
        headers: { Accept: "application/json" },
      });
      const body = (await res.json().catch(() => null)) as
        | WorkbenchRunHistoryListResponse
        | null;

      if (!res.ok) {
        const detail =
          body && "detail" in body && body.detail
            ? body.detail
            : body && "error" in body && body.error
              ? body.error
              : `HTTP ${res.status}`;
        throw new Error(detail);
      }

      setRunHistoryState({
        status: "loaded",
        runs: Array.isArray(body?.runs) ? body.runs : [],
      });
    } catch (err) {
      setRunHistoryState({
        status: "error",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadInitialHistory() {
      if (!cancelled) await loadRunHistory();
    }

    loadInitialHistory();

    return () => {
      cancelled = true;
    };
  }, [loadRunHistory]);

  const runWorkbenchAsk = useCallback(async (nextAsk: string) => {
    const normalizedAsk = nextAsk.trim();
    if (!normalizedAsk) return;
    setAsk(nextAsk);
    setState({ status: "loading" });
    try {
      const res = await fetch("/api/workbench/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ask: normalizedAsk }),
      });
      const body = (await res.json().catch(() => null)) as
        | WorkbenchStartResponse
        | { error?: string; detail?: string }
        | null;
      if (!res.ok) {
        const detail =
          body && "detail" in body && body.detail
            ? body.detail
            : body && "error" in body && body.error
              ? body.error
              : `HTTP ${res.status}`;
        throw new Error(detail);
      }
      setState({ status: "loaded", response: body as WorkbenchStartResponse });
      setWizardStep("context");
      await loadRunHistory({ silent: true });
    } catch (err) {
      setState({
        status: "error",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }, [loadRunHistory]);

  async function handleStart() {
    if (!canSubmit) return;
    await runWorkbenchAsk(ask);
  }

  function handleOpenHistoryRun(run: WorkbenchRunHistoryRow) {
    setAsk(run.ask);
    setState({
      status: "loaded",
      response: toWorkbenchStartResponseFromHistoryRun(run),
    });
    setWizardStep("context");
  }

  return (
    <div
      style={{
        height: "calc(100vh - var(--shell-h))",
        display: "flex",
        flexDirection: "column",
        minHeight: 0,
        background: "var(--bg)",
      }}
    >
      <WorkbenchWizardStepper
        current={wizardStep}
        onJump={(step) => {
          if (canOpenWorkbenchWizardStep(step, loadedResponse)) {
            setWizardStep(step);
          }
        }}
        canJumpTo={(step) => canOpenWorkbenchWizardStep(step, loadedResponse)}
      />

      <div
        style={{
          flex: 1,
          minHeight: 0,
          display: "grid",
          gridTemplateColumns: "minmax(0, 1fr) 320px",
          overflow: "hidden",
        }}
      >
        <main
          aria-live="polite"
          style={{
            minHeight: 0,
            overflow: "hidden",
          }}
        >
          {wizardStep === "setup" ? (
            <WorkbenchSetupStep
              ask={ask}
              canSubmit={canSubmit}
              runState={state}
              runPaneSummary={runPaneSummary}
              onAskChange={setAsk}
              onStart={handleStart}
              setupSummary={setupSummary}
              profileSummary={setupProfileSummary}
            />
          ) : loadedResponse ? (
            <ResultView
              response={loadedResponse}
              ask={ask}
              activeStep={wizardStep}
              onStepChange={setWizardStep}
            />
          ) : (
            <RunPaneStateView summary={runPaneSummary} />
          )}
        </main>

        <WorkbenchWizardSideRail
          profileSummary={setupProfileSummary}
          response={loadedResponse}
          uiSummary={loadedUiSummary}
          profileUpdateStatus={loadedProfileUpdateStatus}
          runHistoryState={runHistoryState}
          selectedRunId={selectedRunId}
          onRefreshRuns={() => loadRunHistory()}
          onOpenRun={handleOpenHistoryRun}
        />
      </div>
    </div>
  );
}

function WorkbenchWizardStepper({
  current,
  onJump,
  canJumpTo,
}: {
  current: WorkbenchWizardStepId;
  onJump: (step: WorkbenchWizardStepId) => void;
  canJumpTo: (step: WorkbenchWizardStepId) => boolean;
}) {
  const currentIndex = workbenchWizardStepIndex(current);

  return (
    <nav
      aria-label="Workbench steps"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 0,
        padding: "18px 32px",
        borderBottom: "1px solid var(--rule)",
        background: "var(--panel)",
        flex: "0 0 auto",
      }}
    >
      {WORKBENCH_WIZARD_STEPS.map((step, index) => {
        const isActive = index === currentIndex;
        const isDone = index < currentIndex;
        const disabled = !canJumpTo(step.id);
        return (
          <div
            key={step.id}
            style={{
              display: "flex",
              alignItems: "center",
              flex: index < WORKBENCH_WIZARD_STEPS.length - 1 ? 1 : "0 0 auto",
              minWidth: 0,
            }}
          >
            <button
              type="button"
              onClick={() => onJump(step.id)}
              disabled={disabled}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                border: "none",
                background: isActive ? "var(--bg)" : "transparent",
                color: isActive || isDone ? "var(--ink)" : "var(--ink-dim)",
                cursor: disabled ? "not-allowed" : "pointer",
                padding: "8px 10px",
                textAlign: "left",
                minWidth: 0,
              }}
            >
              <span
                style={{
                  width: 24,
                  height: 24,
                  display: "grid",
                  placeItems: "center",
                  border: "1px solid var(--rule)",
                  background: isActive ? "var(--ink)" : "transparent",
                  color: isActive ? "var(--bg)" : "var(--ink-dim)",
                  fontFamily: "var(--font-plex-mono)",
                  fontSize: 11,
                  lineHeight: 1,
                }}
              >
                {index + 1}
              </span>
              <span
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 2,
                  minWidth: 0,
                }}
              >
                <span style={{ fontSize: 13, lineHeight: 1.2 }}>
                  {step.label}
                </span>
                <span
                  style={{
                    color: "var(--ink-faint)",
                    fontSize: 11,
                    lineHeight: 1.2,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {step.caption}
                </span>
              </span>
            </button>
            {index < WORKBENCH_WIZARD_STEPS.length - 1 ? (
              <div
                aria-hidden="true"
                style={{
                  flex: 1,
                  height: 1,
                  background: "var(--rule)",
                  margin: "0 12px",
                  minWidth: 20,
                }}
              />
            ) : null}
          </div>
        );
      })}
    </nav>
  );
}

function WorkbenchSetupStep({
  ask,
  canSubmit,
  runState,
  runPaneSummary,
  onAskChange,
  onStart,
  setupSummary,
  profileSummary,
}: {
  ask: string;
  canSubmit: boolean;
  runState: RunState;
  runPaneSummary: WorkbenchRunPaneSummary;
  onAskChange: (ask: string) => void;
  onStart: () => void;
  setupSummary: WorkbenchSetupSummary;
  profileSummary: ReturnType<typeof deriveWorkbenchPersonalisationSummary>;
}) {
  return (
    <div
      style={{
        height: "100%",
        display: "flex",
        flexDirection: "column",
        minHeight: 0,
        overflow: "hidden",
      }}
    >
      <div
        className="scroll"
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: "auto",
          padding: "32px 48px",
        }}
      >
        <div style={{ maxWidth: 760, margin: "0 auto" }}>
          <WorkbenchStepHeading
            step="setup"
            title="Start a piece of work"
            detail="Paste the task, brief, message, or output you need. Workbench will check the setup, gather context, and move you through the next step."
          />

          <label
            htmlFor="workbench-ask"
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 8,
              color: "var(--ink-faint)",
              fontFamily: "var(--font-plex-mono)",
              fontSize: 10,
              letterSpacing: "0.14em",
              textTransform: "uppercase",
            }}
          >
            What are you working on?
            <textarea
              id="workbench-ask"
              value={ask}
              onChange={(event) => onAskChange(event.target.value)}
              placeholder="Paste the task, brief, message, or output you need."
              style={{
                width: "100%",
                minHeight: 170,
                resize: "vertical",
                padding: 14,
                border: "1px solid var(--rule)",
                background: "var(--bg)",
                color: "var(--ink)",
                fontFamily: "var(--font-plex-sans)",
                fontSize: 14,
                lineHeight: 1.5,
                textTransform: "none",
                letterSpacing: 0,
              }}
            />
          </label>

          <div style={{ marginTop: 14 }}>
            {runState.status === "loading" ? (
              <InlineStatus tone="info" message={runPaneSummary.detail} />
            ) : null}
            {runState.status === "error" ? (
              <InlineStatus tone="error" message={runPaneSummary.detail} />
            ) : null}
          </div>

          <div style={{ marginTop: 24 }}>
            <ProfileHubCallout
              setupSummary={setupSummary}
              profileSummary={profileSummary}
            />
          </div>
        </div>
      </div>

      <WorkbenchWizardActionBar
        summary={[
          setupSummary.label,
          "Profile manages connections",
        ]}
        primaryAction={{
          label: runState.status === "loading" ? "Starting" : "Start Workbench",
          onClick: onStart,
          disabled: !canSubmit,
        }}
      />
    </div>
  );
}

function ProfileHubCallout({
  setupSummary,
  profileSummary,
}: {
  setupSummary: WorkbenchSetupSummary;
  profileSummary: ReturnType<typeof deriveWorkbenchPersonalisationSummary>;
}) {
  return (
    <section
      aria-label="Profile hub"
      style={{
        border: "1px solid var(--rule)",
        background: "var(--panel)",
        padding: "13px 14px",
        display: "grid",
        gridTemplateColumns: "minmax(0, 1fr) auto",
        gap: 14,
        alignItems: "center",
      }}
    >
      <div style={{ minWidth: 0 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            flexWrap: "wrap",
            marginBottom: 7,
          }}
        >
          <StatusPill status={profileSummary.statusLabel} />
          <StatusPill status={setupSummary.label} />
        </div>
        <div style={{ color: "var(--ink)", fontSize: 13, lineHeight: 1.35 }}>
          Profile is where Workbench connections and personalisation live.
        </div>
        <div
          style={{
            color: "var(--ink-dim)",
            fontSize: 12,
            lineHeight: 1.35,
            marginTop: 3,
          }}
        >
          {profileSummary.detail}
        </div>
      </div>
      <a
        href="/profile"
        style={{
          border: "1px solid var(--rule-2)",
          color: "var(--ink)",
          padding: "7px 10px",
          fontFamily: "var(--font-plex-mono)",
          fontSize: 10,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          whiteSpace: "nowrap",
        }}
      >
        Open Profile
      </a>
    </section>
  );
}

function WorkbenchWizardSideRail({
  profileSummary,
  response,
  uiSummary,
  profileUpdateStatus,
  runHistoryState,
  selectedRunId,
  onRefreshRuns,
  onOpenRun,
}: {
  profileSummary: ReturnType<typeof deriveWorkbenchPersonalisationSummary>;
  response: WorkbenchStartResponse | null;
  uiSummary: ReturnType<typeof deriveWorkbenchUiSummary> | null;
  profileUpdateStatus: WorkbenchProfileUpdateStatus | null;
  runHistoryState: WorkbenchRunHistoryState;
  selectedRunId: string | null;
  onRefreshRuns: () => void;
  onOpenRun: (run: WorkbenchRunHistoryRow) => void;
}) {
  return (
    <aside
      style={{
        borderLeft: "1px solid var(--rule)",
        background: "var(--panel)",
        display: "flex",
        flexDirection: "column",
        minHeight: 0,
        overflow: "hidden",
      }}
    >
      <section style={{ padding: "18px 20px 12px" }}>
        <SectionEyebrow>Your Profile</SectionEyebrow>
        <div style={{ marginTop: 10 }}>
          {response && profileUpdateStatus ? (
            <CompactProfilePanel
              status={profileUpdateStatus}
              profile={response.profile ?? null}
            />
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <StatusPill status={profileSummary.statusLabel} />
              <div
                style={{
                  color: "var(--ink-dim)",
                  fontSize: 13,
                  lineHeight: 1.45,
                }}
              >
                {profileSummary.detail}
              </div>
            </div>
          )}
        </div>
      </section>

      <div style={{ height: 1, background: "var(--rule)" }} />

      <section style={{ padding: "14px 20px" }}>
        <SectionEyebrow>
          {uiSummary ? `Sources (${uiSummary.retrievalRows.length})` : "Sources"}
        </SectionEyebrow>
        <div style={{ marginTop: 10 }}>
          {uiSummary ? (
            <RetrievalStatusList rows={uiSummary.retrievalRows} compact />
          ) : (
            <div style={{ color: "var(--ink-dim)", fontSize: 12, lineHeight: 1.4 }}>
              Connections are managed in{" "}
              <a href="/profile" style={{ color: "var(--ink)" }}>
                Profile
              </a>
              . Workbench will show sources here after a run.
            </div>
          )}
        </div>
      </section>

      <div style={{ flex: 1, minHeight: 0 }} />

      <RunHistoryPanel
        state={runHistoryState}
        selectedRunId={selectedRunId}
        onRefresh={onRefreshRuns}
        onOpenRun={onOpenRun}
      />
    </aside>
  );
}

function WorkbenchStepHeading({
  step,
  title,
  detail,
}: {
  step: WorkbenchWizardStepId;
  title: string;
  detail: string;
}) {
  const stepIndex = workbenchWizardStepIndex(step) + 1;
  const stepLabel = WORKBENCH_WIZARD_STEPS.find((item) => item.id === step)?.label;

  return (
    <div style={{ marginBottom: 28 }}>
      <SectionEyebrow>
        Step {String(stepIndex).padStart(2, "0")} | {stepLabel}
      </SectionEyebrow>
      <h1
        style={{
          margin: "8px 0 8px",
          fontSize: 28,
          lineHeight: 1.15,
          fontWeight: 600,
          letterSpacing: 0,
        }}
      >
        {title}
      </h1>
      <p
        style={{
          margin: 0,
          color: "var(--ink-dim)",
          fontSize: 15,
          lineHeight: 1.5,
          maxWidth: 620,
        }}
      >
        {detail}
      </p>
    </div>
  );
}

function WorkbenchWizardActionBar({
  summary,
  backLabel,
  onBack,
  secondaryAction,
  primaryAction,
}: {
  summary: string[];
  backLabel?: string;
  onBack?: () => void;
  secondaryAction?: WorkbenchWizardAction | null;
  primaryAction: WorkbenchWizardAction;
}) {
  return (
    <div
      style={{
        flex: "0 0 auto",
        borderTop: "1px solid var(--rule)",
        background: "var(--panel)",
        padding: "14px 24px",
        display: "flex",
        alignItems: "center",
        gap: 12,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          color: "var(--ink-dim)",
          fontSize: 12,
          minWidth: 0,
        }}
      >
        {summary.map((item, index) => (
          <span key={`${item}-${index}`} style={{ whiteSpace: "nowrap" }}>
            {index > 0 ? " | " : ""}
            {item}
          </span>
        ))}
      </div>
      <div style={{ flex: 1 }} />
      {onBack ? (
        <SmallActionButton type="button" onClick={onBack}>
          {backLabel ?? "Back"}
        </SmallActionButton>
      ) : null}
      {secondaryAction ? (
        <SmallActionButton
          type="button"
          onClick={secondaryAction.onClick}
          disabled={secondaryAction.disabled}
        >
          {secondaryAction.label}
        </SmallActionButton>
      ) : null}
      <button
        type="button"
        onClick={primaryAction.onClick}
        disabled={primaryAction.disabled}
        style={{
          border: "1px solid var(--ink)",
          background: primaryAction.disabled ? "transparent" : "var(--ink)",
          color: primaryAction.disabled ? "var(--ink-dim)" : "var(--bg)",
          padding: "10px 14px",
          fontFamily: "var(--font-plex-mono)",
          fontSize: 11,
          letterSpacing: "0.12em",
          textTransform: "uppercase",
        }}
      >
        {primaryAction.label}
      </button>
    </div>
  );
}

function canOpenWorkbenchWizardStep(
  step: WorkbenchWizardStepId,
  response: WorkbenchStartResponse | null,
) {
  return step === "setup" || Boolean(response);
}

function workbenchWizardStepIndex(step: WorkbenchWizardStepId) {
  return Math.max(
    0,
    WORKBENCH_WIZARD_STEPS.findIndex((item) => item.id === step),
  );
}

function firstDetail(
  blockers: string[] | undefined,
  missingScopes: string[] | undefined,
  fallback: string,
) {
  const blocker = blockers?.find(Boolean);
  if (blocker) return blocker;
  const missingScope = missingScopes?.find(Boolean);
  if (missingScope) return missingScope;
  return fallback;
}

function deriveGoogleSetupState(
  readiness: WorkbenchGoogleReadiness | null | undefined,
): WorkbenchSetupConnectorState {
  if (!readiness) return "unavailable";
  if (readiness.ready) return "ready";
  if (readiness.status === "grant_missing") return "not_connected";
  if (GOOGLE_REAUTH_STATUSES.has(readiness.status)) return "reauth_required";
  if (GOOGLE_RESOURCE_MISSING_STATUSES.has(readiness.status)) {
    return "resource_missing";
  }
  if (GOOGLE_REPAIR_STATUSES.has(readiness.status)) return "repair_available";
  return "unavailable";
}

function formatRepairSetupDetail(connectors: WorkbenchSetupAffordance[]) {
  const needsPageRepair = connectors.some(
    (connector) => connector.id === "notion",
  );
  const needsReconnect = connectors.some(
    (connector) => connector.id === "googleWorkspace",
  );

  if (needsPageRepair && needsReconnect) {
    return "Repair Notion and reconnect Google Workspace before running.";
  }
  if (needsPageRepair) return "Repair Notion pages before running.";
  if (needsReconnect) return "Reconnect Google Workspace before running.";
  return `Repair ${formatConnectorList(
    connectors.map((connector) => connector.label),
  )} before running.`;
}

function connectorManagementSourceForSetupAffordance(
  affordance: WorkbenchSetupAffordance,
): WorkbenchConnectorManagementSource | null {
  if (affordance.id === "notion") return "notion";
  if (affordance.id === "googleWorkspace") return "google_workspace";
  return null;
}

function toSearchParams(
  search: string | URLSearchParams | null | undefined,
): URLSearchParams | null {
  if (!search) return null;
  if (search instanceof URLSearchParams) return search;
  const normalized = search.startsWith("?") ? search.slice(1) : search;
  return normalized ? new URLSearchParams(normalized) : null;
}

function formatConnectorList(labels: string[]) {
  if (labels.length === 0) return "connectors";
  if (labels.length === 1) return labels[0] ?? "connectors";
  if (labels.length === 2) return `${labels[0]} and ${labels[1]}`;
  return `${labels.slice(0, -1).join(", ")}, and ${labels[labels.length - 1]}`;
}

function truncateSnippet(value: string, maxLength: number) {
  const normalized = value.trim().replace(/\s+/g, " ");
  if (normalized.length <= maxLength) return normalized || "Empty request";
  return `${normalized.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`;
}

function pluralize(count: number, noun: string) {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

function buildWorkbenchPostRunArtifactSpecInput(
  response: WorkbenchStartResponse,
) {
  const task = response.result.decoded_task;
  return [
    task.summary || "Workbench task result",
    `Deliverable: ${task.deliverable_type || "Not specified"}`,
    `Task type: ${task.task_type || "Not specified"}`,
    `Clarification: ${
      response.result.drafted_clarifying_message.trim() || "None returned."
    }`,
  ].join("\n");
}

export function buildWorkbenchContextAugmentedAsk(
  baseAsk: string,
  answers: WorkbenchResumeSafeResult["context_answers"],
): string {
  const contextLines = answers
    .map((answer) => {
      const question = answer.question.trim();
      const value = answer.answer.trim();
      if (!question || !value) return null;
      return `- ${question}: ${value}`;
    })
    .filter((line): line is string => Boolean(line));

  const normalizedBase = baseAsk.trim() || "Continue the Workbench task.";
  if (contextLines.length === 0) return normalizedBase;

  return [
    normalizedBase,
    "",
    "Additional context supplied by staff:",
    ...contextLines,
  ].join("\n");
}

function buildWorkbenchMakeAsk(
  baseAsk: string,
  fallbackAsk: string,
  contextResumeState: ContextResumeState,
): string {
  const answers =
    contextResumeState.status === "loaded"
      ? contextResumeState.resume.context_answers
      : [];
  return buildWorkbenchContextAugmentedAsk(baseAsk || fallbackAsk, answers);
}

function buildWorkbenchFeedbackActions(
  response: WorkbenchStartResponse,
): WorkbenchPostRunAction[] {
  const runId =
    response.run_history?.status === "stored"
      ? response.run_history.id
      : undefined;
  const payload = {
    task_type: response.invocation.task_type,
    source_count: response.result.retrieved_context.length,
    warning_count: dedupeWarnings([
      ...response.result.warnings,
      ...(response.retrieval.warnings ?? []),
    ]).length,
  };

  return [
    {
      id: "feedback_useful",
      label: "Useful",
      detail: "Mark this Workbench run as useful.",
      status: "ready",
      endpoint: "/api/workbench/actions",
      method: "POST",
      payload: {
        action: "feedback_useful",
        ...(runId ? { run_id: runId } : {}),
        payload,
      },
    },
    {
      id: "feedback_not_useful",
      label: "Not useful",
      detail: "Mark this Workbench run as not useful.",
      status: "ready",
      endpoint: "/api/workbench/actions",
      method: "POST",
      payload: {
        action: "feedback_not_useful",
        ...(runId ? { run_id: runId } : {}),
        payload,
      },
    },
  ];
}

function summarizePresendResponse(response: WorkbenchPresendResponse): {
  message: string;
  href?: string;
} {
  const saveBack = response.save_back;
  if (saveBack.status === "saved") {
    return {
      message: `Saved to Drive: ${saveBack.source.name}`,
      href: saveBack.source.webUrl ?? undefined,
    };
  }

  if (saveBack.status === "skipped") {
    return { message: "Pre-send checks completed. No Drive save-back required." };
  }

  if (saveBack.status === "unavailable") {
    return { message: `Save-back unavailable: ${saveBack.reason}` };
  }

  return { message: `Save-back failed: ${saveBack.message}` };
}

function ResultView({
  response,
  ask,
  activeStep,
  onStepChange,
}: {
  response: WorkbenchStartResponse;
  ask: string;
  activeStep: Exclude<WorkbenchWizardStepId, "setup">;
  onStepChange: (step: WorkbenchWizardStepId) => void;
}) {
  const result = response.result;
  const storedRunId =
    response.run_history?.status === "stored" ? response.run_history.id : null;
  const [postRunState, setPostRunState] = useState<PostRunState>({
    status: "idle",
  });
  const [makeState, setMakeState] = useState<MakeState>({ status: "idle" });
  const [reviewState, setReviewState] = useState<ReviewState>({
    status: "idle",
  });
  const [contextAnswers, setContextAnswers] = useState<Record<string, string>>({});
  const [contextResumeState, setContextResumeState] =
    useState<ContextResumeState>({
      status: "idle",
    });
  const uiSummary = useMemo(() => deriveWorkbenchUiSummary(response), [response]);
  const baseWorkflow = useMemo(() => readWorkbenchWorkflow(response), [response]);
  const workflow =
    contextResumeState.status === "loaded"
      ? contextResumeState.resume.workflow
      : baseWorkflow;
  const makeArtifact =
    makeState.status === "loaded" ? makeState.result.artifact : null;
  const reviewedArtifact = useMemo(
    () => buildReviewedArtifactForSave(makeArtifact, reviewState),
    [makeArtifact, reviewState],
  );
  const postRunActions = useMemo(
    () =>
      deriveWorkbenchPostRunActions(response, {
        reviewedArtifact,
        requireReviewedArtifact: true,
      }),
    [response, reviewedArtifact],
  );

  useEffect(() => {
    setContextAnswers({});
    setContextResumeState({ status: "idle" });
    setMakeState({ status: "idle" });
    setReviewState({ status: "idle" });
    setPostRunState({ status: "idle" });
  }, [storedRunId, result.decoded_task.summary]);

  async function handlePostRunAction(action: WorkbenchPostRunAction) {
    if (action.status !== "ready") return;
    setPostRunState({ status: "running", actionId: action.id });
    try {
      const res = await fetch(action.endpoint, {
        method: action.method,
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(action.payload),
      });
      const body = (await res.json().catch(() => null)) as
        | WorkbenchPresendResponse
        | WorkbenchOutputActionOutcome
        | { error?: string; detail?: string }
        | null;

      if (!res.ok) {
        const detail =
          body && "detail" in body && body.detail
            ? body.detail
            : body && "error" in body && body.error
              ? body.error
              : `HTTP ${res.status}`;
        throw new Error(detail);
      }

      const summary =
        action.id === "presend"
          ? summarizePresendResponse(body as WorkbenchPresendResponse)
          : summarizeFeedbackResponse(body as WorkbenchOutputActionOutcome);
      setPostRunState({
        status: "loaded",
        actionId: action.id,
        message: summary.message,
        href: summary.href,
      });
    } catch (err) {
      setPostRunState({
        status: "error",
        actionId: action.id,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  function handleContextAnswerChange(questionId: string, value: string) {
    setContextAnswers((current) => ({ ...current, [questionId]: value }));
  }

  async function handleContextResume(action: WorkbenchResumeAction) {
    if (!storedRunId) return;
    setContextResumeState({ status: "running", action });
    try {
      const res = await fetch(`/api/workbench/runs/${storedRunId}/resume`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          action,
          ...(action === "answer_context"
            ? { answers: answeredContextPayload(workflow, contextAnswers) }
            : {}),
        }),
      });
      const body = (await res.json().catch(() => null)) as
        | WorkbenchResumeRouteResponse
        | null;

      if (!res.ok || !body || !("resume" in body)) {
        const detail =
          body && "detail" in body && body.detail
            ? body.detail
            : body && "error" in body && body.error
              ? body.error
              : `HTTP ${res.status}`;
        throw new Error(detail);
      }

      const resume = body.resume;
      setContextResumeState({ status: "loaded", resume });
      if (
        resume.status === "resumed" &&
        (action === "answer_context" ||
          action === "continue_with_assumptions")
      ) {
        onStepChange("generate");
      }
    } catch (err) {
      setContextResumeState({
        status: "error",
        action,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  async function handleMake() {
    setMakeState({ status: "running" });
    setReviewState({ status: "idle" });
    try {
      const res = await fetch("/api/workbench/make", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          ask: buildWorkbenchMakeAsk(
            ask,
            result.decoded_task.summary,
            contextResumeState,
          ),
          preflight_result: result,
          retrieved_context:
            response.retrieval.context.length > 0
              ? response.retrieval.context
              : result.retrieved_context,
        }),
      });
      const body = (await res.json().catch(() => null)) as
        | WorkbenchMakeResult
        | { error?: string; detail?: string; message?: string }
        | null;

      if (!res.ok || !isDraftedMakeResult(body)) {
        const detail =
          body && "message" in body && body.message
            ? body.message
            : body && "detail" in body && body.detail
              ? body.detail
              : body && "error" in body && body.error
                ? body.error
                : `HTTP ${res.status}`;
        throw new Error(
          sanitizeWorkbenchDetail(
            detail,
            "Workbench could not generate a draft. Check the local server logs and try again.",
          ),
        );
      }

      setMakeState({ status: "loaded", result: body });
    } catch (err) {
      setMakeState({
        status: "error",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  async function handleReview() {
    if (!makeArtifact) return;
    setReviewState({ status: "running" });
    try {
      const res = await fetch("/api/workbench/review", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          ask: ask.trim() || result.decoded_task.summary,
          preflight_result: result,
          artifact: makeArtifact,
        }),
      });
      const body = (await res.json().catch(() => null)) as
        | WorkbenchReviewResult
        | { error?: string; detail?: string; message?: string }
        | null;

      if (!res.ok || !isReviewResult(body)) {
        const detail =
          body && "message" in body && body.message
            ? body.message
            : body && "detail" in body && body.detail
              ? body.detail
              : body && "error" in body && body.error
                ? body.error
                : `HTTP ${res.status}`;
        throw new Error(detail);
      }

      setReviewState({ status: "loaded", result: body });
    } catch (err) {
      setReviewState({
        status: "error",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const saveAction = postRunActions.find((action) => action.id === "presend");
  const primaryAction = buildWorkbenchWizardPrimaryAction({
    activeStep,
    workflow,
    contextAnswers,
    contextResumeState,
    makeState,
    reviewState,
    saveAction,
    onStepChange,
    onResume: handleContextResume,
    onMake: handleMake,
    onReview: handleReview,
    onSave:
      saveAction?.status === "ready"
        ? () => handlePostRunAction(saveAction)
        : undefined,
  });
  const secondaryAction = buildWorkbenchWizardSecondaryAction({
    activeStep,
    workflow,
    contextResumeState,
    onResume: handleContextResume,
  });

  return (
    <div
      style={{
        height: "100%",
        display: "flex",
        flexDirection: "column",
        minHeight: 0,
        overflow: "hidden",
      }}
    >
      <div
        className="scroll"
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: "auto",
          padding: "32px 48px",
        }}
      >
        <div style={{ maxWidth: 760, margin: "0 auto" }}>
          {activeStep === "context" ? (
            <ContextWizardStep
              result={result}
              workflow={workflow}
              runId={storedRunId}
              answers={contextAnswers}
              resumeState={contextResumeState}
              onAnswerChange={handleContextAnswerChange}
              onResume={handleContextResume}
            />
          ) : null}

          {activeStep === "generate" ? (
            <GenerateWizardStep
              makeState={makeState}
            />
          ) : null}

          {activeStep === "review" ? (
            <ReviewWizardStep
              makeArtifact={makeArtifact}
              state={reviewState}
              actions={postRunActions}
              postRunState={postRunState}
              onAction={handlePostRunAction}
            />
          ) : null}
        </div>
      </div>

      <WorkbenchWizardActionBar
        summary={[
          `${uiSummary.sourceCount} source items`,
          uiSummary.baselineLabel,
          `${uiSummary.warningCount} warnings`,
        ]}
        backLabel={activeStep === "context" ? "Back to Setup" : "Back"}
        onBack={() => onStepChange(previousWorkbenchWizardStep(activeStep))}
        secondaryAction={secondaryAction}
        primaryAction={primaryAction}
      />
    </div>
  );
}

function ContextWizardStep({
  result,
  workflow,
  runId,
  answers,
  resumeState,
  onAnswerChange,
  onResume,
}: {
  result: WorkbenchPreflightResult;
  workflow: WorkbenchWorkflowState;
  runId: string | null;
  answers: Record<string, string>;
  resumeState: ContextResumeState;
  onAnswerChange: (questionId: string, value: string) => void;
  onResume: (action: WorkbenchResumeAction) => void;
}) {
  return (
    <>
      <WorkbenchStepHeading
        step="context"
        title={
          workflow.context_questions.length > 0
            ? "Add the missing context"
            : "Context is ready"
        }
        detail={
          workflow.context_questions.length > 0
            ? "Answer what you can below. Workbench reuses the basics, so this should stay short."
            : "Workbench has enough context to draft. You can still review the task summary before generating."
        }
      />

      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <CompactPanel title="Task summary">
          <CompactTaskSummary result={result} workflow={workflow} />
        </CompactPanel>
        <ContextNeededPanel
          workflow={workflow}
          runId={runId}
          answers={answers}
          resumeState={resumeState}
          onAnswerChange={onAnswerChange}
          onResume={onResume}
          showActions={false}
        />
      </div>
    </>
  );
}

function GenerateWizardStep({
  makeState,
}: {
  makeState: MakeState;
}) {
  return (
    <>
      <WorkbenchStepHeading
        step="generate"
        title="Generate the first draft"
        detail="Workbench will use the decoded task, gathered context, and profile signals to create a usable starting point."
      />

      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <CompactPanel title="Generated draft" scroll>
          {makeState.status === "idle" ? (
            <TextBlock text="Generate a draft when the brief looks right." />
          ) : null}
          {makeState.status === "running" ? (
            <InlineStatus tone="info" message="Generating the first draft." />
          ) : null}
          {makeState.status === "loaded" ? (
            <ArtifactPreview artifact={makeState.result.artifact} />
          ) : null}
          {makeState.status === "error" ? (
            <InlineStatus tone="error" message={makeState.message} />
          ) : null}
        </CompactPanel>
      </div>
    </>
  );
}

function ReviewWizardStep({
  makeArtifact,
  state,
  actions,
  postRunState,
  onAction,
}: {
  makeArtifact: WorkbenchArtifact | null;
  state: ReviewState;
  actions: WorkbenchPostRunAction[];
  postRunState: PostRunState;
  onAction: (action: WorkbenchPostRunAction) => void;
}) {
  return (
    <>
      <WorkbenchStepHeading
        step="review"
        title="Review and ship"
        detail="Run the quality gate, check the senior challenge, then save or mark the work."
      />

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)",
          gap: 14,
          alignItems: "start",
        }}
      >
        <CompactPanel title="Review" scroll>
          {!makeArtifact ? (
            <TextBlock text="Generate a draft before reviewing it." />
          ) : null}
          {makeArtifact && state.status === "idle" ? (
            <TextBlock text="Run review when the draft is ready." />
          ) : null}
          {state.status === "running" ? (
            <InlineStatus tone="info" message="Reviewing the draft." />
          ) : null}
          {state.status === "loaded" ? <ReviewSummary result={state.result} /> : null}
          {state.status === "error" ? (
            <InlineStatus tone="error" message={state.message} />
          ) : null}
        </CompactPanel>
        <CompactPanel title="Save and feedback">
          <CompactPostRunActions
            actions={actions}
            state={postRunState}
            onAction={onAction}
          />
        </CompactPanel>
      </div>
    </>
  );
}

function buildWorkbenchWizardPrimaryAction({
  activeStep,
  workflow,
  contextAnswers,
  contextResumeState,
  makeState,
  reviewState,
  saveAction,
  onStepChange,
  onResume,
  onMake,
  onReview,
  onSave,
}: {
  activeStep: Exclude<WorkbenchWizardStepId, "setup">;
  workflow: WorkbenchWorkflowState;
  contextAnswers: Record<string, string>;
  contextResumeState: ContextResumeState;
  makeState: MakeState;
  reviewState: ReviewState;
  saveAction?: WorkbenchPostRunAction;
  onStepChange: (step: WorkbenchWizardStepId) => void;
  onResume: (action: WorkbenchResumeAction) => void;
  onMake: () => void;
  onReview: () => void;
  onSave?: () => void;
}): WorkbenchWizardAction {
  if (activeStep === "context") {
    if (workflow.missing_required_context_count === 0) {
      return {
        label: "Continue to Generate",
        onClick: () => onStepChange("generate"),
      };
    }

    const missingCount = unansweredRequiredContextCount(workflow, contextAnswers);
    return {
      label:
        contextResumeState.status === "running"
          ? "Continuing"
          : "Add context and continue",
      onClick: () => onResume("answer_context"),
      disabled: contextResumeState.status === "running" || missingCount > 0,
    };
  }

  if (activeStep === "generate") {
    if (makeState.status === "running") {
      return { label: "Generating", disabled: true };
    }
    if (makeState.status === "loaded") {
      return {
        label: "Continue to Review",
        onClick: () => onStepChange("review"),
      };
    }
    return {
      label: makeState.status === "error" ? "Try Generate again" : "Generate draft",
      onClick: onMake,
    };
  }

  if (makeState.status !== "loaded") {
    return {
      label: "Back to Generate",
      onClick: () => onStepChange("generate"),
    };
  }
  if (reviewState.status === "running") {
    return { label: "Reviewing", disabled: true };
  }
  if (reviewState.status === "loaded") {
    return {
      label: saveAction?.status === "ready" ? saveAction.label : "Save reviewed draft",
      onClick: onSave,
      disabled: saveAction?.status !== "ready" || !onSave,
    };
  }
  return {
    label: reviewState.status === "error" ? "Try Review again" : "Review draft",
    onClick: onReview,
    disabled: !onReview,
  };
}

function buildWorkbenchWizardSecondaryAction({
  activeStep,
  workflow,
  contextResumeState,
  onResume,
}: {
  activeStep: Exclude<WorkbenchWizardStepId, "setup">;
  workflow: WorkbenchWorkflowState;
  contextResumeState: ContextResumeState;
  onResume: (action: WorkbenchResumeAction) => void;
}): WorkbenchWizardAction | null {
  if (
    activeStep !== "context" ||
    workflow.missing_required_context_count === 0 ||
    !workflow.can_continue_with_assumptions
  ) {
    return null;
  }

  return {
    label:
      contextResumeState.status === "running"
        ? "Continuing"
        : "Continue without this",
    onClick: () => onResume("continue_with_assumptions"),
    disabled: contextResumeState.status === "running",
  };
}

function previousWorkbenchWizardStep(
  step: Exclude<WorkbenchWizardStepId, "setup">,
): WorkbenchWizardStepId {
  if (step === "review") return "generate";
  if (step === "generate") return "context";
  return "setup";
}

function contextAnswerValue(
  workflow: WorkbenchWorkflowState,
  answers: Record<string, string>,
  questionId: string,
) {
  const localAnswer = answers[questionId];
  if (localAnswer != null) return localAnswer;
  return (
    workflow.context_answers.find((answer) => answer.question_id === questionId)
      ?.answer ?? ""
  );
}

function unansweredRequiredContextCount(
  workflow: WorkbenchWorkflowState,
  answers: Record<string, string>,
) {
  return workflow.context_questions.filter(
    (question) =>
      question.required &&
      !contextAnswerValue(workflow, answers, question.id).trim().length,
  ).length;
}

function CompactPanel({
  title,
  children,
  scroll,
  style,
}: {
  title: string;
  children: React.ReactNode;
  scroll?: boolean;
  style?: React.CSSProperties;
}) {
  return (
    <section
      style={{
        border: "1px solid var(--rule)",
        background: "var(--panel)",
        padding: "10px 11px",
        minHeight: 0,
        display: "flex",
        flexDirection: "column",
        gap: 8,
        overflow: "hidden",
        ...style,
      }}
    >
      <SectionEyebrow>{title}</SectionEyebrow>
      <div
        style={{
          minHeight: 0,
          overflow: scroll ? "auto" : "visible",
        }}
      >
        {children}
      </div>
    </section>
  );
}

function CompactTaskSummary({
  result,
  workflow,
}: {
  result: WorkbenchPreflightResult;
  workflow: WorkbenchWorkflowState;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
      <TextBlock text={result.decoded_task.summary || "Task decoded."} />
      <WorkflowSummaryText workflow={workflow} />
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        <StatusPill status={result.decoded_task.deliverable_type ?? "Output"} />
        <StatusPill status={result.decoded_task.task_type} />
      </div>
      {result.drafted_clarifying_message ? (
        <div style={{ color: "var(--ink-dim)", fontSize: 12, lineHeight: 1.35 }}>
          {result.drafted_clarifying_message}
        </div>
      ) : null}
    </div>
  );
}

function CompactPostRunActions({
  actions,
  state,
  onAction,
}: {
  actions: WorkbenchPostRunAction[];
  state: PostRunState;
  onAction: (action: WorkbenchPostRunAction) => void;
}) {
  if (actions.length === 0) return <TextBlock text="No actions available." />;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
      {actions.map((action) => {
        const running = state.status === "running" && state.actionId === action.id;
        const disabled = action.status === "disabled" || running;
        return (
          <div
            key={action.id}
            style={{
              display: "grid",
              gridTemplateColumns: "minmax(0, 1fr) auto",
              gap: 8,
              alignItems: "center",
            }}
          >
            <div style={{ minWidth: 0 }}>
              <div style={{ color: "var(--ink)", fontSize: 12, lineHeight: 1.25 }}>
                {action.label}
              </div>
              <div
                style={{
                  marginTop: 2,
                  color: "var(--ink-dim)",
                  fontSize: 11,
                  lineHeight: 1.25,
                }}
              >
                {action.detail}
              </div>
            </div>
            <SmallActionButton
              type="button"
              onClick={() => onAction(action)}
              disabled={disabled}
            >
              {postRunButtonLabel(action, running)}
            </SmallActionButton>
          </div>
        );
      })}
      <PostRunStatus state={state} />
    </div>
  );
}

function CompactProfilePanel({
  status,
  profile,
}: {
  status: WorkbenchProfileUpdateStatus;
  profile: WorkbenchStartResponse["profile"] | null;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {status.state !== "idle" ? (
        <div>
          <StatusPill status={status.label} />
          <div
            style={{
              marginTop: 5,
              color: "var(--ink-dim)",
              fontSize: 12,
              lineHeight: 1.35,
            }}
          >
            {status.detail}
          </div>
        </div>
      ) : null}
      {profile ? (
        <div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <StatusPill status={`${profile.source_refs.length} profile sources`} />
            {profile.warnings.length > 0 ? (
              <StatusPill status={`${profile.warnings.length} warnings`} />
            ) : null}
          </div>
          <div
            style={{
              marginTop: 7,
              color: "var(--ink)",
              fontSize: 12,
              lineHeight: 1.4,
              whiteSpace: "pre-wrap",
            }}
          >
            {profile.summary_text.trim() || "No profile context was available."}
          </div>
        </div>
      ) : (
        <TextBlock text="No profile context was available." />
      )}
    </div>
  );
}

function summarizeFeedbackResponse(response: WorkbenchOutputActionOutcome): {
  message: string;
  href?: string;
} {
  if (response.status === "unavailable") {
    return { message: `Feedback unavailable: ${response.reason}` };
  }
  if (response.reason === "feedback_recorded") {
    return { message: "Feedback recorded." };
  }
  if (response.reason === "feedback_storage_unavailable") {
    return { message: "Feedback accepted. Storage is unavailable." };
  }
  return { message: `Feedback accepted: ${response.reason}` };
}

function readWorkbenchProfileUpdate(
  response: WorkbenchStartResponse,
): WorkbenchProfileUpdateInput {
  return (
    response as WorkbenchStartResponse & {
      profile_update?: WorkbenchProfileUpdateInput;
    }
  ).profile_update;
}

function readWorkbenchWorkflow(
  response: WorkbenchStartResponse,
): WorkbenchWorkflowState {
  return response.workflow ?? buildWorkbenchWorkflowState(response.result);
}

function isDraftedMakeResult(
  value:
    | WorkbenchMakeResult
    | { error?: string; detail?: string; message?: string }
    | null,
): value is Extract<WorkbenchMakeResult, { status: "drafted" }> {
  return Boolean(value && "status" in value && value.status === "drafted");
}

function isReviewResult(
  value:
    | WorkbenchReviewResult
    | { error?: string; detail?: string; message?: string }
    | null,
): value is WorkbenchReviewResult {
  return Boolean(value && "status" in value && value.status === "reviewed");
}

function answeredContextPayload(
  workflow: WorkbenchWorkflowState,
  answers: Record<string, string>,
): Record<string, string> {
  return Object.fromEntries(
    workflow.context_questions
      .map((question) => [question.id, answers[question.id]?.trim() ?? ""] as const)
      .filter(([, answer]) => answer.length > 0),
  );
}

export function deriveWorkbenchStageRows(
  workflow: WorkbenchWorkflowState,
): WorkbenchStageRow[] {
  const missing = workflow.missing_required_context_count;
  const hasMissingContext = missing > 0;

  return [
    {
      id: "understand",
      label: "Understand",
      state: "complete",
      summary: "Workbench has decoded the task and likely output.",
    },
    {
      id: "gather",
      label: "Gather",
      state: hasMissingContext ? "active" : "complete",
      summary: hasMissingContext
        ? `${pluralize(missing, "detail")} needed before drafting.`
        : "Context, sources, and profile have been checked.",
    },
    {
      id: "make",
      label: "Make",
      state: hasMissingContext ? "locked" : "available",
      summary: hasMissingContext
        ? "Add the missing context first."
        : "Ready to generate a first draft.",
    },
    {
      id: "review",
      label: "Review",
      state: "locked",
      summary: "Generate a draft before review.",
    },
    {
      id: "save",
      label: "Save",
      state: "locked",
      summary: "Review the draft before saving.",
    },
  ];
}

function WorkflowSummaryText({
  workflow,
}: {
  workflow: WorkbenchWorkflowState;
}) {
  if (workflow.missing_required_context_count > 0) {
    return (
      <TextBlock
        text={`${pluralize(
          workflow.missing_required_context_count,
          "piece",
        )} of context needed before drafting.`}
      />
    );
  }
  if (workflow.using_assumptions) {
    return <TextBlock text="Ready to draft, using labelled assumptions." />;
  }
  return <TextBlock text="Ready to draft. Context checks have completed." />;
}

function ArtifactPreview({
  artifact,
  compact,
}: {
  artifact: WorkbenchArtifact;
  compact?: boolean;
}) {
  return (
    <div
      style={{
        border: "1px solid var(--rule)",
        padding: "10px 11px",
        background: compact ? "var(--bg)" : "var(--panel)",
      }}
    >
      <KeyValue label="Type" value={artifact.type} />
      <KeyValue label="Title" value={artifact.title} />
      <div
        style={{
          maxHeight: compact ? 220 : undefined,
          overflow: compact ? "auto" : "visible",
        }}
      >
        <TextBlock text={artifact.body} />
      </div>
      <div style={{ marginTop: 10 }}>
        <SimpleList items={artifact.assumptions} empty="No assumptions listed." />
      </div>
      <div style={{ marginTop: 10 }}>
        <SimpleList
          items={artifact.source_refs.map(
            (source) => `${source.source_type}: ${source.source_label}`,
          )}
          empty="No source references attached."
        />
      </div>
    </div>
  );
}

function ReviewSummary({
  result,
  compact,
}: {
  result: WorkbenchReviewResult;
  compact?: boolean;
}) {
  const review = result.review;
  return (
    <div
      style={{
        border: "1px solid var(--rule)",
        padding: "10px 11px",
        background: compact ? "var(--bg)" : "var(--panel)",
      }}
    >
      <KeyValue label="Status" value={review.overall_status} />
      <ReviewList label="Senior challenge" items={review.senior_challenge} />
      <ReviewList label="Assumptions" items={review.assumptions} />
      <ReviewList label="Evidence gaps" items={review.evidence_gaps} />
      <ReviewList label="Cookbook check" items={review.cookbook_check} />
      <ReviewList label="Tone check" items={review.tone_check} />
      <ReviewList label="Manual checks" items={review.manual_verification} />
      {result.warnings?.length ? (
        <ReviewList label="Warnings" items={result.warnings} />
      ) : null}
    </div>
  );
}

function ReviewList({ label, items }: { label: string; items: string[] }) {
  return (
    <div style={{ marginTop: 10 }}>
      <div
        style={{
          color: "var(--ink-faint)",
          fontFamily: "var(--font-plex-mono)",
          fontSize: 10,
          letterSpacing: "0.1em",
          textTransform: "uppercase",
        }}
      >
        {label}
      </div>
      <SimpleList items={items} empty="Clear." />
    </div>
  );
}

function buildReviewedArtifactForSave(
  artifact: WorkbenchArtifact | null,
  reviewState: ReviewState,
): WorkbenchPresendReviewedArtifact | null {
  if (!artifact) return null;
  return {
    artifact_type: artifact.type,
    title: artifact.title,
    review_status:
      reviewState.status === "loaded"
        ? reviewState.result.review.overall_status
        : null,
    source_count: artifact.source_refs.length,
    destination: "drive",
  };
}

function InlineStatus({
  tone,
  message,
}: {
  tone: "error" | "info";
  message: string;
}) {
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      style={{
        color: tone === "error" ? "var(--danger, #9f1d1d)" : "var(--ink-dim)",
        fontSize: 12,
        lineHeight: 1.35,
      }}
    >
      {sanitizeWorkbenchDetail(message)}
    </div>
  );
}

function ContextNeededPanel({
  workflow,
  runId,
  answers,
  resumeState,
  onAnswerChange,
  onResume,
  showActions = true,
}: {
  workflow: WorkbenchWorkflowState;
  runId: string | null;
  answers: Record<string, string>;
  resumeState: ContextResumeState;
  onAnswerChange: (questionId: string, value: string) => void;
  onResume: (action: WorkbenchResumeAction) => void;
  showActions?: boolean;
}) {
  const [openedQuestionIds, setOpenedQuestionIds] = useState<string[]>([]);

  if (workflow.context_questions.length === 0) {
    return <TextBlock text="No extra context needed. Generate the draft when ready." />;
  }

  const runningAction =
    resumeState.status === "running" ? resumeState.action : null;
  const unansweredRequired = unansweredRequiredContextCount(workflow, answers);
  const canAnswer = Boolean(runId) && unansweredRequired === 0;
  const canContinue = Boolean(runId) && workflow.can_continue_with_assumptions;
  const firstUnansweredQuestion = workflow.context_questions.find(
    (question) =>
      !contextAnswerValue(workflow, answers, question.id).trim().length,
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {workflow.context_questions.map((question) => {
        const value = contextAnswerValue(workflow, answers, question.id);
        const status = value.trim().length
          ? "complete"
          : firstUnansweredQuestion?.id === question.id ||
              openedQuestionIds.includes(question.id)
            ? "active"
            : "todo";

        return (
          <div
            key={question.id}
            style={{
              border: "1px solid var(--rule)",
              background: "var(--panel)",
              padding: 20,
              display: "flex",
              flexDirection: "column",
              gap: 10,
              boxShadow:
                status === "active" ? "inset 0 0 0 1px var(--ink)" : "none",
            }}
          >
            <ContextQuestionCardContent
              question={question}
              value={value}
              status={status}
              onOpen={() =>
                setOpenedQuestionIds((current) =>
                  current.includes(question.id)
                    ? current
                    : [...current, question.id],
                )
              }
              onChange={(nextValue) => onAnswerChange(question.id, nextValue)}
            />
          </div>
        );
      })}

      <div style={{ color: "var(--ink-dim)", fontSize: 12, lineHeight: 1.35 }}>
        {unansweredRequired === 0
          ? "All required context is filled in."
          : `${pluralize(
              unansweredRequired,
              "answer",
            )} still needed before Workbench can continue.`}
      </div>

      {showActions ? (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <SmallActionButton
            type="button"
            onClick={() => onResume("answer_context")}
            disabled={!canAnswer || runningAction === "answer_context"}
          >
            {runningAction === "answer_context"
              ? "Continuing"
              : "Add context and continue"}
          </SmallActionButton>
          <SmallActionButton
            type="button"
            onClick={() => onResume("continue_with_assumptions")}
            disabled={
              !canContinue || runningAction === "continue_with_assumptions"
            }
          >
            {runningAction === "continue_with_assumptions"
              ? "Continuing"
              : "Continue without this"}
          </SmallActionButton>
          <SmallActionButton
            type="button"
            onClick={() => onResume("stop_run")}
            disabled={!runId || runningAction === "stop_run"}
          >
            {runningAction === "stop_run" ? "Pausing" : "Pause run"}
          </SmallActionButton>
        </div>
      ) : null}

      <ContextResumeStatus state={resumeState} runId={runId} />
    </div>
  );
}

function ContextQuestionCardContent({
  question,
  value,
  status,
  onOpen,
  onChange,
}: {
  question: WorkbenchWorkflowState["context_questions"][number];
  value: string;
  status: "complete" | "active" | "todo";
  onOpen: () => void;
  onChange: (value: string) => void;
}) {
  const shouldShowInput = status !== "todo";

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span
          style={{
            color: "var(--ink-faint)",
            fontFamily: "var(--font-plex-mono)",
            fontSize: 10,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
          }}
        >
          {status}
        </span>
        {question.required ? <StatusPill status="Required" /> : null}
      </div>

      <div>
        <h3
          style={{
            margin: "0 0 6px",
            color: "var(--ink)",
            fontSize: 17,
            lineHeight: 1.25,
            fontWeight: 600,
            letterSpacing: 0,
          }}
        >
          {question.question}
        </h3>
        <p
          style={{
            margin: 0,
            color: "var(--ink-dim)",
            fontSize: 13,
            lineHeight: 1.4,
          }}
        >
          {question.why}
        </p>
      </div>

      {question.suggested_sources.length > 0 ? (
        <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
          {question.suggested_sources.map((source) => (
            <StatusPill key={`${question.id}-${source}`} status={source} />
          ))}
        </div>
      ) : null}

      {shouldShowInput ? (
        <textarea
          value={value}
          onChange={(event) => onChange(event.target.value)}
          rows={status === "active" ? 4 : 2}
          placeholder="Type the missing detail here."
          style={setupInputStyle({
            minHeight: status === "active" ? 104 : 58,
            resize: "vertical",
          })}
        />
      ) : (
        <button
          type="button"
          onClick={onOpen}
          style={{
            alignSelf: "flex-start",
            border: "none",
            background: "transparent",
            color: "var(--ink-dim)",
            padding: 0,
            fontFamily: "var(--font-plex-mono)",
            fontSize: 10,
            letterSpacing: "0.12em",
            textTransform: "uppercase",
            cursor: "pointer",
          }}
        >
          + Answer this
        </button>
      )}
    </>
  );
}

function ContextResumeStatus({
  state,
  runId,
}: {
  state: ContextResumeState;
  runId: string | null;
}) {
  if (!runId) {
    return (
      <div style={{ color: "var(--ink-dim)", fontSize: 12, lineHeight: 1.35 }}>
        This run was not saved, so Workbench cannot continue it.
      </div>
    );
  }
  if (state.status === "idle" || state.status === "running") return null;

  if (state.status === "error") {
    return (
      <div role="alert" style={{ color: "var(--danger, #9f1d1d)", fontSize: 12 }}>
        {sanitizeWorkbenchDetail(state.message)}
      </div>
    );
  }

  const unresolvedCount = state.resume.unresolved_context.length;
  return (
    <div style={{ color: "var(--ink-dim)", fontSize: 12, lineHeight: 1.35 }}>
      {state.resume.status === "stopped"
        ? "Run paused."
        : unresolvedCount === 0
          ? "Context added. Workbench is continuing with the extra detail."
          : `${pluralize(unresolvedCount, "answer")} still needed.`}
    </div>
  );
}

function postRunButtonLabel(action: WorkbenchPostRunAction, running: boolean) {
  if (running) return action.id === "presend" ? "Saving" : "Sending";
  if (action.status === "disabled") return "Disabled";
  if (action.id === "presend") return "Save";
  return "Send";
}

function PostRunStatus({ state }: { state: PostRunState }) {
  if (state.status === "idle" || state.status === "running") return null;

  return (
    <div
      role={state.status === "error" ? "alert" : "status"}
      style={{
        color:
          state.status === "error"
            ? "var(--danger, #9f1d1d)"
            : "var(--ink-dim)",
        fontSize: 12,
        lineHeight: 1.35,
      }}
    >
      {state.message}
      {state.status === "loaded" && state.href ? (
        <>
          {" "}
          <a href={state.href} target="_blank" rel="noreferrer">
            Open
          </a>
        </>
      ) : null}
    </div>
  );
}

function SectionEyebrow({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontFamily: "var(--font-plex-mono)",
        fontSize: 10,
        letterSpacing: "0.18em",
        textTransform: "uppercase",
        color: "var(--ink-faint)",
      }}
    >
      {children}
    </div>
  );
}

export function ConnectorReadinessPanel({
  summary,
}: {
  summary: WorkbenchConnectorSummary;
}) {
  return (
    <section
      aria-label="Connector readiness"
      style={{
        borderBottom: "1px solid var(--rule)",
        padding: "14px 24px",
        display: "flex",
        flexDirection: "column",
        gap: 9,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 10,
        }}
      >
        <SectionEyebrow>Connectors</SectionEyebrow>
        <StatusPill status={summary.overallStatus} />
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {summary.rows.map((row) => (
          <div
            key={row.id}
            style={{
              display: "grid",
              gridTemplateColumns: "118px 92px minmax(0, 1fr)",
              gap: 8,
              alignItems: "center",
              minHeight: 26,
              fontSize: 12,
              lineHeight: 1.25,
            }}
          >
            <span style={{ color: "var(--ink)", whiteSpace: "nowrap" }}>
              {row.label}
            </span>
            <StatusPill status={row.status} />
            <span
              title={row.detail}
              style={{
                color: "var(--ink-dim)",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                minWidth: 0,
              }}
            >
              {row.detail}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}

export function WorkbenchSetupPanel({
  form,
  config,
  onboardingForm,
  onboardingState,
  onFormChange,
  onOnboardingFormChange,
  onSave,
  onOnboardingDraft,
  onOnboardingSave,
  onSetupNotion,
  onCheck,
  onConnectorManagementAction,
  onConnectGoogle,
  setupState,
  connectorManagementState,
  setupAffordances,
  setupSummary,
  oauthNotice,
  healthRows,
  healthGeneratedAt,
}: {
  form: WorkbenchConfigForm;
  config: WorkbenchStaffConfig | null;
  onboardingForm: WorkbenchOnboardingForm;
  onboardingState: WorkbenchOnboardingState;
  onFormChange: (form: WorkbenchConfigForm) => void;
  onOnboardingFormChange: (form: WorkbenchOnboardingForm) => void;
  onSave: (event: FormEvent<HTMLFormElement>) => void;
  onOnboardingDraft: (event: FormEvent<HTMLFormElement>) => void;
  onOnboardingSave: () => void;
  onSetupNotion: () => void;
  onCheck: () => void;
  onConnectorManagementAction: (
    action: WorkbenchConnectorManagementAction,
  ) => void;
  onConnectGoogle: () => void;
  setupState: SetupState;
  connectorManagementState: WorkbenchConnectorManagementState;
  setupAffordances: WorkbenchSetupAffordanceSummary;
  setupSummary: WorkbenchSetupSummary;
  oauthNotice: WorkbenchOAuthNotice | null;
  healthRows: WorkbenchHealthRow[];
  healthGeneratedAt: string | null;
}) {
  const isSaving = setupState.status === "saving";
  const isChecking = setupState.status === "checking";
  const isOnboardingBusy =
    onboardingState.status === "drafting" || onboardingState.status === "saving";
  const personalisationSummary = deriveWorkbenchPersonalisationSummary({
    setupReady: setupSummary.state === "ready",
    config,
  });
  const profileSeedExists = hasWorkbenchProfileSeed(config);

  function updateField(field: keyof WorkbenchConfigForm, value: string) {
    onFormChange({ ...form, [field]: value });
  }

  function updateOnboardingField<K extends keyof WorkbenchOnboardingForm>(
    field: K,
    value: WorkbenchOnboardingForm[K],
  ) {
    onOnboardingFormChange({ ...onboardingForm, [field]: value });
  }

  function toggleOnboardingListItem(
    field:
      | "work_type_chips"
      | "communication_style"
      | "challenge_style"
      | "helpful_context",
    value: string,
  ) {
    const selected = onboardingForm[field];
    updateOnboardingField(
      field,
      selected.includes(value)
        ? selected.filter((item) => item !== value)
        : [...selected, value],
    );
  }

  return (
    <section
      aria-label="Staff setup"
      style={{
        borderBottom: "1px solid var(--rule)",
        padding: "14px 24px",
        display: "flex",
        flexDirection: "column",
        gap: 10,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
        }}
      >
        <SectionEyebrow>Setup</SectionEyebrow>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          <SmallActionButton type="button" onClick={onCheck} disabled={isChecking}>
            {isChecking ? "Checking" : "Check connectors"}
          </SmallActionButton>
        </div>
      </div>

      {oauthNotice ? <SetupNotice notice={oauthNotice} /> : null}
      <SetupSummaryBanner summary={setupSummary} />

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 8,
        }}
      >
        <SetupActionRow
          affordance={setupAffordances.notion}
          onAction={onSetupNotion}
          managementState={connectorManagementState}
          onManagementAction={onConnectorManagementAction}
        />
        <SetupActionRow
          affordance={setupAffordances.googleWorkspace}
          onAction={onConnectGoogle}
          managementState={connectorManagementState}
          onManagementAction={onConnectorManagementAction}
        />
      </div>

      <ConnectorManagementStatus state={connectorManagementState} />

      <form
        onSubmit={onOnboardingDraft}
        style={{
          border: "1px solid var(--rule)",
          padding: "9px",
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 8,
        }}
      >
        <div
          style={{
            gridColumn: "1 / -1",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 8,
          }}
        >
          <div>
            <div
              style={{
                color: "var(--ink)",
                fontSize: 12,
                lineHeight: 1.2,
              }}
            >
              {personalisationSummary.title}
            </div>
            <div
              style={{
                marginTop: 3,
                color: "var(--ink-dim)",
                fontSize: 11,
                lineHeight: 1.25,
              }}
            >
              {personalisationSummary.detail}
            </div>
          </div>
          <StatusPill status={personalisationSummary.statusLabel} />
        </div>
        <SetupInput
          label="Role / title"
          value={onboardingForm.role_title}
          onChange={(value) => updateOnboardingField("role_title", value)}
          required={!profileSeedExists}
        />
        <label
          style={{
            gridColumn: "1 / -1",
            display: "flex",
            flexDirection: "column",
            gap: 4,
            color: "var(--ink-faint)",
            fontFamily: "var(--font-plex-mono)",
            fontSize: 9,
            letterSpacing: "0.1em",
            textTransform: "uppercase",
          }}
        >
          Current focus
          <textarea
            value={onboardingForm.current_focus_bullets}
            onChange={(event) =>
              updateOnboardingField("current_focus_bullets", event.target.value)
            }
            rows={2}
            required={!profileSeedExists}
            style={setupInputStyle({ minHeight: 52, resize: "vertical" })}
          />
        </label>
        <SetupCheckboxGroup
          label="What sorts of things are you working on?"
          options={WORKBENCH_WORK_TYPE_OPTIONS}
          selected={onboardingForm.work_type_chips}
          onToggle={(value) => toggleOnboardingListItem("work_type_chips", value)}
        />
        <SetupInput
          label="Other work"
          value={onboardingForm.work_type_other}
          onChange={(value) => updateOnboardingField("work_type_other", value)}
        />
        <SetupCheckboxGroup
          label="Communication style"
          options={WORKBENCH_COMMUNICATION_STYLE_OPTIONS}
          selected={onboardingForm.communication_style}
          onToggle={(value) =>
            toggleOnboardingListItem("communication_style", value)
          }
        />
        <SetupCheckboxGroup
          label="How should Workbench challenge you?"
          options={WORKBENCH_CHALLENGE_STYLE_OPTIONS}
          selected={onboardingForm.challenge_style}
          onToggle={(value) => toggleOnboardingListItem("challenge_style", value)}
        />
        <SetupCheckboxGroup
          label="Helpful working context"
          options={WORKBENCH_HELPFUL_CONTEXT_OPTIONS}
          selected={onboardingForm.helpful_context}
          onToggle={(value) => toggleOnboardingListItem("helpful_context", value)}
        />
        <SetupInput
          label="Other context"
          value={onboardingForm.helpful_context_other}
          onChange={(value) =>
            updateOnboardingField("helpful_context_other", value)
          }
        />
        <OnboardingPreview state={onboardingState} />
        <div
          style={{
            gridColumn: "1 / -1",
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}
        >
          <SmallActionButton type="submit" disabled={isSaving || isOnboardingBusy}>
            {onboardingState.status === "drafting"
              ? "Drafting"
              : "Preview profile"}
          </SmallActionButton>
          <SmallActionButton
            type="button"
            onClick={onOnboardingSave}
            disabled={onboardingState.status !== "drafted"}
          >
            {onboardingState.status === "saving" ? "Saving" : "Save to Notion"}
          </SmallActionButton>
          <span
            role={onboardingState.status === "error" ? "alert" : undefined}
            style={{
              color:
                onboardingState.status === "error"
                  ? "var(--danger, #9f1d1d)"
                  : "var(--ink-faint)",
              fontSize: 11,
              lineHeight: 1.3,
            }}
          >
            {onboardingState.status === "saved"
              ? onboardingState.message
              : onboardingState.status === "error"
                ? sanitizeWorkbenchDetail(onboardingState.message)
                : ""}
          </span>
        </div>
      </form>

      <details
        {...(setupAffordances.manualConfig.initiallyOpen ? { open: true } : {})}
        style={{
          borderTop: "1px solid var(--rule)",
          paddingTop: 8,
        }}
      >
        <summary
          style={{
            cursor: "pointer",
            color: "var(--ink-dim)",
            fontFamily: "var(--font-plex-mono)",
            fontSize: 9,
            letterSpacing: "0.1em",
            textTransform: "uppercase",
          }}
        >
          {setupAffordances.manualConfig.summaryLabel}
          <span style={{ color: "var(--ink-faint)", marginLeft: 8 }}>
            {setupAffordances.manualConfig.secondaryLabel}
          </span>
        </summary>

        <form
          onSubmit={onSave}
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 8,
            marginTop: 10,
          }}
        >
          <SetupInput
            label="Notion parent"
            value={form.notion_parent_page_id}
            onChange={(value) => updateField("notion_parent_page_id", value)}
            required
          />
          <SetupInput
            label="Drive folder"
            value={form.drive_folder_id}
            onChange={(value) => updateField("drive_folder_id", value)}
            required
          />
          <div style={{ gridColumn: "1 / -1" }}>
            <SetupInput
              label="Drive URL"
              value={form.drive_folder_url}
              onChange={(value) => updateField("drive_folder_url", value)}
              required
            />
          </div>
          <SetupInput
            label="Communication style"
            value={form.voice_register}
            onChange={(value) => updateField("voice_register", value)}
          />
          <SetupInput
            label="Challenge style"
            value={form.feedback_style}
            onChange={(value) => updateField("feedback_style", value)}
          />
          <label
            style={{
              gridColumn: "1 / -1",
              display: "flex",
              flexDirection: "column",
              gap: 4,
              color: "var(--ink-faint)",
              fontFamily: "var(--font-plex-mono)",
              fontSize: 9,
              letterSpacing: "0.1em",
              textTransform: "uppercase",
            }}
          >
            Work types
            <textarea
              value={form.friction_tasks}
              onChange={(event) =>
                updateField("friction_tasks", event.target.value)
              }
              rows={2}
              style={setupInputStyle({ minHeight: 52, resize: "vertical" })}
            />
          </label>
          <div
            style={{
              gridColumn: "1 / -1",
              display: "flex",
              alignItems: "center",
              gap: 8,
            }}
          >
            <SmallActionButton type="submit" disabled={isSaving}>
              {isSaving ? "Saving" : "Save manual fields"}
            </SmallActionButton>
            <span
              role={setupState.status === "error" ? "alert" : undefined}
              style={{
                color:
                  setupState.status === "error"
                    ? "var(--danger, #9f1d1d)"
                    : "var(--ink-faint)",
                fontSize: 11,
                lineHeight: 1.3,
              }}
            >
              {setupState.status === "saved"
                ? "Saved"
                : setupState.status === "error"
                  ? sanitizeWorkbenchDetail(setupState.message)
                  : ""}
            </span>
          </div>
        </form>
      </details>

      {healthRows.length > 0 ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <div
            style={{
              color: "var(--ink-faint)",
              fontFamily: "var(--font-plex-mono)",
              fontSize: 9,
              letterSpacing: "0.1em",
              textTransform: "uppercase",
            }}
          >
            Health {healthGeneratedAt ? formatCompactDate(healthGeneratedAt) : ""}
          </div>
          {healthRows.map((row) => (
            <div
              key={row.source}
              style={{
                display: "grid",
                gridTemplateColumns: "82px 84px 48px minmax(0, 1fr)",
                gap: 6,
                alignItems: "center",
                fontSize: 11,
                lineHeight: 1.2,
              }}
            >
              <span style={{ fontFamily: "var(--font-plex-mono)" }}>
                {row.source}
              </span>
              <StatusPill status={row.status} />
              <span style={{ color: "var(--ink-dim)" }}>{row.itemsCount}</span>
              <span
                title={row.reason ?? "Clear"}
                style={{
                  color: "var(--ink-dim)",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {sanitizeWorkbenchDetail(row.reason, "Clear")}
              </span>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function RunHistoryPanel({
  state,
  selectedRunId,
  onRefresh,
  onOpenRun,
}: {
  state: WorkbenchRunHistoryState;
  selectedRunId: string | null;
  onRefresh: () => void;
  onOpenRun: (run: WorkbenchRunHistoryRow) => void;
}) {
  const rows = useMemo(
    () =>
      state.status === "loaded" ? deriveWorkbenchRunHistoryRows(state.runs) : [],
    [state],
  );

  return (
    <section
      aria-label="Recent runs"
      style={{
        borderBottom: "1px solid var(--rule)",
        padding: "14px 24px",
        display: "flex",
        flexDirection: "column",
        gap: 9,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 10,
        }}
      >
        <SectionEyebrow>Recent work</SectionEyebrow>
        <SmallActionButton
          type="button"
          onClick={onRefresh}
          disabled={state.status === "loading"}
        >
          {state.status === "loading" ? "Loading" : "Refresh"}
        </SmallActionButton>
      </div>

      {state.status === "error" ? (
        <div
          role="alert"
          style={{
            color: "var(--danger, #9f1d1d)",
            fontSize: 12,
            lineHeight: 1.35,
          }}
        >
          {state.message}
        </div>
      ) : null}

      {state.status === "loaded" && state.runs.length === 0 ? (
        <div style={{ color: "var(--ink-dim)", fontSize: 12, lineHeight: 1.35 }}>
          No recent work yet.
        </div>
      ) : null}

      {state.status === "loaded" && state.runs.length > 0 ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {state.runs.map((run) => {
            const row = rows.find((item) => item.id === run.id);
            if (!row) return null;
            const selected = selectedRunId === run.id;
            return (
              <button
                key={run.id}
                type="button"
                onClick={() => onOpenRun(run)}
                style={{
                  border: "1px solid var(--rule)",
                  background: selected ? "var(--bg)" : "var(--panel)",
                  color: "var(--ink)",
                  padding: "8px 9px",
                  textAlign: "left",
                  display: "grid",
                  gridTemplateColumns: "54px minmax(0, 1fr)",
                  gap: 8,
                  alignItems: "start",
                }}
              >
                <span
                  style={{
                    color: "var(--ink-faint)",
                    fontFamily: "var(--font-plex-mono)",
                    fontSize: 10,
                    lineHeight: 1.3,
                  }}
                >
                  {row.createdLabel}
                </span>
                <span style={{ minWidth: 0 }}>
                  <span
                    style={{
                      display: "block",
                      fontSize: 12,
                      lineHeight: 1.25,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {row.askSnippet}
                  </span>
                  <span
                    style={{
                      display: "block",
                      marginTop: 3,
                      color: "var(--ink-dim)",
                      fontFamily: "var(--font-plex-mono)",
                      fontSize: 10,
                      lineHeight: 1.25,
                      textTransform: "uppercase",
                    }}
                  >
                    {row.status} | {row.countLabel}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      ) : null}
    </section>
  );
}

function OnboardingPreview({ state }: { state: WorkbenchOnboardingState }) {
  if (state.status !== "drafted" && state.status !== "saving") return null;
  const draft = state.draft;
  const rows: Array<{ label: string; bullets: string[] }> = [
    { label: "Personal Profile", bullets: draft.personal_profile.bullets },
    { label: "Working On", bullets: draft.working_on.bullets },
    { label: "Voice", bullets: draft.voice.bullets },
  ];

  return (
    <div
      style={{
        gridColumn: "1 / -1",
        borderTop: "1px solid var(--rule)",
        paddingTop: 8,
        display: "flex",
        flexDirection: "column",
        gap: 7,
      }}
    >
      {rows.map((row) => (
        <div key={row.label} style={{ fontSize: 11, lineHeight: 1.35 }}>
          <div
            style={{
              color: "var(--ink)",
              fontFamily: "var(--font-plex-mono)",
              fontSize: 9,
              letterSpacing: "0.1em",
              textTransform: "uppercase",
            }}
          >
            {row.label}
          </div>
          <ul style={{ margin: "4px 0 0", paddingLeft: 16 }}>
            {row.bullets.map((bullet, index) => (
              <li key={`${row.label}-${index}`}>{bullet}</li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

function SetupSummaryBanner({ summary }: { summary: WorkbenchSetupSummary }) {
  return (
    <div
      role={summary.state === "error" ? "alert" : undefined}
      style={{
        border: "1px solid var(--rule)",
        background: summary.state === "ready" ? "var(--bg)" : "var(--panel)",
        padding: "9px 10px",
        display: "grid",
        gridTemplateColumns: "112px minmax(0, 1fr)",
        gap: 8,
        alignItems: "start",
        fontSize: 12,
        lineHeight: 1.3,
      }}
    >
      <StatusPill status={summary.label} />
      <span style={{ color: "var(--ink-dim)" }}>{summary.detail}</span>
    </div>
  );
}

function SetupNotice({ notice }: { notice: WorkbenchOAuthNotice }) {
  return (
    <div
      role={notice.tone === "error" ? "alert" : "status"}
      style={{
        border: "1px solid var(--rule)",
        background: "var(--panel)",
        padding: "8px 10px",
        fontSize: 12,
        lineHeight: 1.35,
      }}
    >
      <span
        style={{
          color:
            notice.tone === "error"
              ? "var(--danger, #9f1d1d)"
              : "var(--ink)",
          fontFamily: "var(--font-plex-mono)",
          fontSize: 10,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          marginRight: 8,
        }}
      >
        {notice.label}
      </span>
      <span style={{ color: "var(--ink-dim)" }}>{notice.detail}</span>
    </div>
  );
}

function SetupActionRow({
  affordance,
  onAction,
  managementState,
  onManagementAction,
}: {
  affordance: WorkbenchSetupAffordance;
  onAction: () => void;
  managementState: WorkbenchConnectorManagementState;
  onManagementAction: (action: WorkbenchConnectorManagementAction) => void;
}) {
  const managementActions = deriveWorkbenchConnectorManagementActions(affordance);
  const repairAction = managementActions.find(
    (action) => action.payload.action === "repair",
  );
  const secondaryActions = managementActions.filter(
    (action) => action.payload.action !== "repair",
  );
  const primaryAction = repairAction ?? null;
  const primaryActionRunning =
    primaryAction &&
    managementState.status === "running" &&
    managementState.actionId === primaryAction.id;
  const primaryDisabled = primaryAction
    ? Boolean(primaryActionRunning)
    : affordance.disabled;

  return (
    <div
      style={{
        border: "1px solid var(--rule)",
        padding: "8px 9px",
        display: "grid",
        gridTemplateColumns: "minmax(92px, 1fr) 112px minmax(0, 1.4fr)",
        gap: 8,
        alignItems: "center",
        minHeight: 44,
      }}
    >
      <div style={{ minWidth: 0 }}>
        <div
          style={{
            color: "var(--ink)",
            fontSize: 12,
            lineHeight: 1.2,
          }}
        >
          {affordance.label}
        </div>
        <div
          title={affordance.detail}
          style={{
            marginTop: 3,
            color: "var(--ink-dim)",
            fontSize: 11,
            lineHeight: 1.2,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {affordance.detail}
        </div>
      </div>
      <StatusPill status={affordance.statusLabel} />
      <div style={{ justifySelf: "end" }}>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "flex-end" }}>
          <SmallActionButton
            type="button"
            onClick={() =>
              primaryAction ? onManagementAction(primaryAction) : onAction()
            }
            disabled={primaryDisabled}
          >
            {primaryActionRunning
              ? setupActionRunningLabel(affordance)
              : affordance.buttonLabel}
          </SmallActionButton>
          {secondaryActions.map((action) => {
            const running =
              managementState.status === "running" &&
              managementState.actionId === action.id;
            return (
              <SmallActionButton
                key={action.id}
                type="button"
                onClick={() => onManagementAction(action)}
                disabled={running}
              >
                {running ? "Working" : action.label}
              </SmallActionButton>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function setupActionRunningLabel(affordance: WorkbenchSetupAffordance) {
  return affordance.id === "notion" ? "Repairing pages" : "Setting up workspace";
}

function ConnectorManagementStatus({
  state,
}: {
  state: WorkbenchConnectorManagementState;
}) {
  if (state.status === "idle" || state.status === "running") return null;

  return (
    <div
      role={state.status === "error" ? "alert" : "status"}
      style={{
        color:
          state.status === "error"
            ? "var(--danger, #9f1d1d)"
            : "var(--ink-dim)",
        fontSize: 12,
        lineHeight: 1.35,
      }}
    >
      {sanitizeWorkbenchDetail(state.message, "Connector updated.")}
    </div>
  );
}

function SetupCheckboxGroup({
  label,
  options,
  selected,
  onToggle,
}: {
  label: string;
  options: readonly string[];
  selected: string[];
  onToggle: (value: string) => void;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      style={{
        gridColumn: "1 / -1",
        display: "flex",
        flexDirection: "column",
        gap: 6,
      }}
    >
      <div
        style={{
          color: "var(--ink-faint)",
          fontFamily: "var(--font-plex-mono)",
          fontSize: 9,
          letterSpacing: "0.1em",
          textTransform: "uppercase",
        }}
      >
        {label}
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        {options.map((option) => {
          const checked = selected.includes(option);
          return (
            <label
              key={option}
              style={{
                border: "1px solid var(--rule)",
                background: checked ? "var(--bg)" : "var(--panel)",
                color: checked ? "var(--ink)" : "var(--ink-dim)",
                padding: "5px 7px",
                display: "inline-flex",
                alignItems: "center",
                gap: 5,
                fontSize: 11,
                lineHeight: 1.2,
              }}
            >
              <input
                type="checkbox"
                checked={checked}
                onChange={() => onToggle(option)}
                style={{ margin: 0 }}
              />
              <span>{option}</span>
            </label>
          );
        })}
      </div>
    </div>
  );
}

function SetupInput({
  label,
  value,
  onChange,
  required,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
}) {
  return (
    <label
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 4,
        color: "var(--ink-faint)",
        fontFamily: "var(--font-plex-mono)",
        fontSize: 9,
        letterSpacing: "0.1em",
        textTransform: "uppercase",
      }}
    >
      {label}
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        required={required}
        style={setupInputStyle()}
      />
    </label>
  );
}

function SmallActionButton({
  children,
  type,
  onClick,
  disabled,
}: {
  children: React.ReactNode;
  type: "button" | "submit";
  onClick?: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      style={{
        border: "1px solid var(--rule)",
        background: disabled ? "var(--panel)" : "var(--bg)",
        color: disabled ? "var(--ink-faint)" : "var(--ink)",
        padding: "6px 8px",
        fontFamily: "var(--font-plex-mono)",
        fontSize: 9,
        letterSpacing: "0.1em",
        textTransform: "uppercase",
      }}
    >
      {children}
    </button>
  );
}

function KeyValue({
  label,
  value,
}: {
  label: string;
  value: string | number | null | undefined;
}) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "120px minmax(0, 1fr)",
        gap: 10,
        padding: "4px 0",
        fontSize: 13,
        lineHeight: 1.45,
      }}
    >
      <span style={{ color: "var(--ink-faint)" }}>{label}</span>
      <span style={{ color: "var(--ink)" }}>{value || "Not specified"}</span>
    </div>
  );
}

function TextBlock({ text }: { text: string }) {
  return (
    <p
      style={{
        margin: 0,
        color: "var(--ink)",
        fontSize: 14,
        lineHeight: 1.55,
        whiteSpace: "pre-wrap",
      }}
    >
      {text}
    </p>
  );
}

function RetrievalStatusList({
  rows,
  compact,
}: {
  rows: WorkbenchRetrievalRow[];
  compact?: boolean;
}) {
  if (rows.length === 0) {
    return <TextBlock text="No retrieval status returned." />;
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: compact ? 6 : 8 }}>
      {rows.map((row) => (
        <div
          key={row.source}
          style={{
            border: "1px solid var(--rule)",
            padding: compact ? "7px 8px" : "9px 10px",
            display: "grid",
            gridTemplateColumns: compact
              ? "minmax(0, 1fr) auto"
              : "130px 120px 90px minmax(0, 1fr)",
            gap: compact ? 7 : 10,
            alignItems: "start",
            fontSize: compact ? 12 : 13,
          }}
        >
          <span style={{ fontFamily: "var(--font-plex-mono)" }}>{row.label}</span>
          <StatusPill status={row.status} />
          <span
            style={{
              color: "var(--ink-dim)",
              gridColumn: compact ? "1 / -1" : undefined,
            }}
          >
            {row.itemsCount} items
          </span>
          <span
            title={[row.reason, ...row.warnings].filter(Boolean).join(" | ")}
            style={{
              color: "var(--ink-dim)",
              gridColumn: compact ? "1 / -1" : undefined,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: compact ? "normal" : "nowrap",
            }}
          >
            {row.detail || "Clear"}
          </span>
        </div>
      ))}
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const normalized = status.toLowerCase();
  const isGood =
    normalized === "available" ||
    normalized === "ok" ||
    normalized === "succeeded" ||
    normalized === "ready" ||
    normalized === "ready to run" ||
    normalized === "connected" ||
    normalized === "complete" ||
    normalized === "available" ||
    normalized === "profile updated" ||
    normalized === "notion" ||
    normalized === "cornerstone" ||
    normalized === "calendar" ||
    normalized === "user" ||
    normalized.endsWith("profile sources");
  const isWarn =
    normalized === "unavailable" ||
    normalized === "loading" ||
    normalized === "active" ||
    normalized === "locked" ||
    normalized === "checking" ||
    normalized === "checking setup" ||
    normalized === "not connected" ||
    normalized === "finish setup" ||
    normalized === "repair setup" ||
    normalized === "reauth required" ||
    normalized === "resource missing" ||
    normalized === "repair available" ||
    normalized === "set up" ||
    normalized === "setting up workspace" ||
    normalized === "needs reconnect" ||
    normalized === "repairing pages" ||
    normalized === "needs profile" ||
    normalized === "needs attention" ||
    normalized === "no profile update";
  return (
    <span
      style={{
        justifySelf: "start",
        border: "1px solid var(--rule)",
        padding: "3px 7px",
        color: isGood
          ? "var(--ink)"
          : isWarn
            ? "var(--ink-dim)"
            : "var(--danger, #9f1d1d)",
        background: isGood ? "var(--bg)" : "var(--panel)",
        fontFamily: "var(--font-plex-mono)",
        fontSize: 10,
        letterSpacing: "0.08em",
        textTransform: "uppercase",
      }}
    >
      {status}
    </span>
  );
}

function SimpleList({ items, empty }: { items: string[]; empty: string }) {
  if (items.length === 0) return <TextBlock text={empty} />;
  return (
    <ul style={{ margin: 0, paddingLeft: 18 }}>
      {items.map((item, index) => (
        <li key={`${item}-${index}`}>{item}</li>
      ))}
    </ul>
  );
}

function dedupeWarnings(items: string[]) {
  return Array.from(new Set(items.filter(Boolean)));
}

function optionalFormString(value: string) {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function splitWorkbenchLines(value: string) {
  return value
    .split(/[\n,]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function dedupeWorkbenchStrings(values: readonly string[]) {
  const seen = new Set<string>();
  const items: string[] = [];
  for (const value of values) {
    const item = value.trim();
    if (!item) continue;
    const key = item.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    items.push(item);
  }
  return items;
}

function setupInputStyle(extra?: React.CSSProperties): React.CSSProperties {
  return {
    width: "100%",
    border: "1px solid var(--rule)",
    background: "var(--bg)",
    color: "var(--ink)",
    padding: "6px 7px",
    fontFamily: "var(--font-plex-sans)",
    fontSize: 12,
    lineHeight: 1.25,
    textTransform: "none",
    letterSpacing: 0,
    ...extra,
  };
}

function formatCompactDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function RunPaneStateView({ summary }: { summary: WorkbenchRunPaneSummary }) {
  return (
    <div
      role={summary.tone === "error" ? "alert" : "status"}
      style={{
        height: "100%",
        display: "grid",
        placeItems: "center",
        padding: 24,
      }}
    >
      <div
        style={{
          border: "1px solid var(--rule)",
          padding: 16,
          color: "var(--ink)",
          background: "var(--panel)",
          maxWidth: 720,
          width: "100%",
        }}
      >
        <SectionEyebrow>{summary.label}</SectionEyebrow>
        <h2
          style={{
            margin: "8px 0 0",
            fontFamily: "var(--font-plex-serif)",
            fontSize: 24,
            lineHeight: 1.15,
            fontWeight: 400,
            letterSpacing: 0,
          }}
        >
          {summary.title}
        </h2>
        <p
          style={{
            margin: "8px 0 0",
            color:
              summary.tone === "error"
                ? "var(--danger, #9f1d1d)"
                : "var(--ink-dim)",
            fontSize: 14,
            lineHeight: 1.45,
          }}
        >
          {summary.detail}
        </p>
      </div>
    </div>
  );
}
