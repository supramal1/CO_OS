"use client";

import { signIn } from "next-auth/react";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import type {
  WorkbenchApproachStep,
  WorkbenchMissingContext,
  WorkbenchPreflightResult,
  WorkbenchRetrievedContext,
  WorkbenchStartResponse,
} from "@/lib/workbench/types";
import type { WorkbenchPresendResponse } from "@/lib/workbench/presend-types";
import type { WorkbenchOutputActionOutcome } from "@/lib/workbench/output-actions";
import type { WorkbenchUserConfig } from "@/lib/workbench/retrieval/types";
import type { WorkbenchRunHistoryRow } from "@/lib/workbench/run-history";

type RunState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "loaded"; response: WorkbenchStartResponse }
  | { status: "error"; message: string };

type WorkbenchRetrievalRow = {
  source: string;
  status: string;
  itemsCount: number;
  reason: string | null;
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

type WorkbenchConnectorManagementResponse = {
  source?: WorkbenchConnectorManagementSource;
  status?: string;
  action?: string;
  next_url?: string;
  message?: string;
  reason?: string;
  error?: string;
  detail?: string;
};

const CALENDAR_READONLY_SCOPE =
  "https://www.googleapis.com/auth/calendar.readonly";
const NOTION_SETUP_HREF = "/api/workbench/notion/start";
const WORKBENCH_CALLBACK_URL = "/workbench?google_oauth=returned";
const WORKBENCH_PRESEND_ROUTE_AVAILABLE = true;

const CONNECTOR_LABELS: Array<Pick<WorkbenchConnectorRow, "id" | "label">> = [
  { id: "notion", label: "Notion config" },
  { id: "drive", label: "Drive folder" },
  { id: "google", label: "Google auth/token" },
  { id: "calendar", label: "Calendar readiness" },
];

const EMPTY_CONFIG_FORM: WorkbenchConfigForm = {
  notion_parent_page_id: "",
  drive_folder_id: "",
  drive_folder_url: "",
  voice_register: "",
  feedback_style: "",
  friction_tasks: "",
};

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
      label: "Checking setup",
      detail: "Checking Notion, Google Workspace, Drive, and Calendar.",
    };
  }

  if (connectors.some((connector) => connector.state === "error")) {
    return {
      state: "error",
      label: "Setup check failed",
      detail: "Fix the API error before running Workbench.",
    };
  }

  if (connectors.every((connector) => connector.state === "ready")) {
    return {
      state: "ready",
      label: "Ready to run",
      detail: "Notion, Google auth, Calendar, and Drive are connected.",
    };
  }

  const needsConnection = connectors.filter(
    (connector) => connector.state === "not_connected",
  );
  if (needsConnection.length > 0) {
    return {
      state: "needs_setup",
      label: "Finish setup",
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
    return {
      state: "repairing",
      label: "Repair setup",
      detail: `Repair ${formatConnectorList(
        repairable.map((connector) => connector.label),
      )} before running.`,
    };
  }

  return {
    state: "unavailable",
    label: "Setup unavailable",
    detail: "Connector setup status is unavailable. Check connectors for details.",
  };
}

export function deriveWorkbenchOAuthNotice(
  search: string | URLSearchParams | null | undefined,
): WorkbenchOAuthNotice | null {
  const params = toSearchParams(search);
  if (!params) return null;

  if (params.get("notion_setup") === "failed") {
    return {
      tone: "error",
      label: "Notion setup needs repair",
      detail: params.get("reason") || "notion_setup_failed",
    };
  }

  if (params.get("google_oauth") === "returned") {
    return {
      tone: "info",
      label: "Google OAuth returned",
      detail: "Checking saved Google Workspace access now.",
    };
  }

  const oauthError = params.get("error");
  if (oauthError) {
    return {
      tone: "error",
      label: "OAuth returned an error",
      detail: params.get("error_description") || oauthError,
    };
  }

  return null;
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
      statusLabel: "Checking",
      detail: "Checking connector",
      disabled: true,
    };
  }

  if (connectorState.status === "error") {
    return {
      ...base,
      state: "error",
      statusLabel: "Error",
      detail: connectorState.message,
    };
  }

  const notionParentPageId =
    connectorState.config?.notion_parent_page_id?.trim() ?? "";

  if (!notionParentPageId) {
    return {
      ...base,
      state: "not_connected",
      statusLabel: "Not connected",
      detail: "Notion setup needed",
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
        statusLabel: setupStateLabel(healthState),
        detail: health.reason ?? health.status,
      };
    }
  }

  return {
    ...base,
    state: "ready",
    statusLabel: "Ready",
    detail: "Connected to Notion workspace",
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
      statusLabel: "Checking",
      detail: "Checking connector",
      buttonLabel: "Connect Google Workspace",
      disabled: true,
    };
  }

  if (connectorState.status === "error") {
    return {
      ...base,
      state: "error",
      statusLabel: "Error",
      detail: connectorState.message,
    };
  }

  const driveFolderId = connectorState.config?.drive_folder_id?.trim() ?? "";
  const readiness = connectorState.google_readiness;
  if (!readiness) {
    return {
      ...base,
      state: "unavailable",
      statusLabel: "Unavailable",
      detail: "google_readiness unavailable",
    };
  }

  if (readiness.ready) {
    if (!driveFolderId) {
      return {
        ...base,
        state: "resource_missing",
        statusLabel: "Resource missing",
        detail: "drive_folder_id missing",
      };
    }
    return {
      ...base,
      state: "ready",
      statusLabel: "Ready",
      detail: "Drive and Calendar connected",
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
      statusLabel: "Not connected",
      detail,
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
    statusLabel: setupStateLabel(state),
    detail,
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

function setupStateLabel(state: WorkbenchSetupConnectorState) {
  switch (state) {
    case "not_connected":
      return "Not connected";
    case "ready":
      return "Ready";
    case "reauth_required":
      return "Reauth required";
    case "resource_missing":
      return "Resource missing";
    case "repair_available":
      return "Repair available";
    case "error":
      return "Error";
    case "loading":
      return "Checking";
    case "unavailable":
      return "Unavailable";
  }
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
        detail: "Checking",
      })),
    };
  }

  if (state.status === "error") {
    return {
      overallStatus: "error",
      rows: CONNECTOR_LABELS.map((row) => ({
        ...row,
        status: "error",
        detail: state.message,
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
  const calendarReady =
    Boolean(googleReadiness?.ready) &&
    (googleReadiness?.granted_scopes ?? []).includes(CALENDAR_READONLY_SCOPE);
  const calendarDetail = calendarReady
    ? "calendar.readonly available"
    : firstDetail(
        googleReadiness?.blockers,
        googleReadiness?.missing_scopes,
        googleDetail,
      );
  const googleAction = shouldShowGoogleConnect(googleReadiness)
    ? "google_reconsent"
    : undefined;

  const rows: WorkbenchConnectorRow[] = [
    {
      id: "notion",
      label: "Notion config",
      status: notionParentPageId ? "ready" : "unavailable",
      detail: notionParentPageId || "notion_parent_page_id missing",
    },
    {
      id: "drive",
      label: "Drive folder",
      status: driveFolderId ? "ready" : "unavailable",
      detail: driveFolderId || "drive_folder_id missing",
    },
    {
      id: "google",
      label: "Google auth/token",
      status: googleReadiness?.ready ? "ready" : "unavailable",
      detail: googleDetail,
      action: googleAction,
    },
    {
      id: "calendar",
      label: "Calendar readiness",
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
      detail: "Retrieving context and drafting the pre-flight response.",
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
    label: "Ready for ask",
    title: "Ready when setup is ready",
    detail: "Paste an ask and run Workbench.",
  };
}

export function deriveWorkbenchPostRunActions(
  response: WorkbenchStartResponse,
  options?: { presendRouteAvailable?: boolean },
): WorkbenchPostRunAction[] {
  const presendRouteAvailable =
    options?.presendRouteAvailable ?? WORKBENCH_PRESEND_ROUTE_AVAILABLE;
  const feedbackActions = buildWorkbenchFeedbackActions(response);

  if (!presendRouteAvailable) {
    return [
      {
        id: "presend",
        label: "Prepare save-back artifact",
        detail: "Pre-send/save-back route is not available in this build.",
        status: "disabled",
        disabledReason: "presend_route_unavailable",
      },
      ...feedbackActions,
    ];
  }

  return [
    {
      id: "presend",
      label: "Prepare save-back artifact",
      detail:
        "Run pre-send checks and save a staff-ready artifact to Drive when required.",
      status: "ready",
      endpoint: "/api/workbench/presend",
      method: "POST",
      payload: {
        preflight_result: response.result,
        artifact_spec_input: buildWorkbenchPostRunArtifactSpecInput(response),
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
      return {
        source: source.source,
        status: source.status,
        itemsCount: source.items.length,
        reason: status?.reason ?? null,
        warnings: source.warnings,
      };
    });
  }

  return response.retrieval.statuses.map((status) => ({
    source: status.source,
    status: status.status,
    itemsCount: status.items_count,
    reason: status.reason ?? null,
    warnings: [],
  }));
}

export function WorkbenchShell() {
  const [ask, setAsk] = useState("");
  const [state, setState] = useState<RunState>({ status: "idle" });
  const [connectorState, setConnectorState] =
    useState<WorkbenchConnectorState>({ status: "loading" });
  const [configForm, setConfigForm] = useState<WorkbenchConfigForm>(
    EMPTY_CONFIG_FORM,
  );
  const [setupState, setSetupState] = useState<SetupState>({ status: "idle" });
  const [healthRows, setHealthRows] = useState<WorkbenchHealthRow[]>([]);
  const [healthGeneratedAt, setHealthGeneratedAt] = useState<string | null>(null);
  const [oauthNotice, setOauthNotice] = useState<WorkbenchOAuthNotice | null>(
    null,
  );
  const [runHistoryState, setRunHistoryState] =
    useState<WorkbenchRunHistoryState>({ status: "loading" });
  const [connectorManagementState, setConnectorManagementState] =
    useState<WorkbenchConnectorManagementState>({ status: "idle" });

  const canSubmit = ask.trim().length > 0 && state.status !== "loading";
  const selectedRunId =
    state.status === "loaded" && state.response.run_history?.status === "stored"
      ? state.response.run_history.id
      : null;
  const connectorSummary = useMemo(
    () => deriveWorkbenchConnectorSummary(connectorState),
    [connectorState],
  );
  const setupAffordances = useMemo(
    () => deriveWorkbenchSetupAffordances({ connectorState, healthRows }),
    [connectorState, healthRows],
  );
  const setupSummary = useMemo(
    () => deriveWorkbenchSetupSummary(setupAffordances),
    [setupAffordances],
  );
  const runPaneSummary = useMemo(
    () => deriveWorkbenchRunPaneSummary(state),
    [state],
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
      setConfigForm(getInitialWorkbenchConfigForm(config));
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
    setOauthNotice(deriveWorkbenchOAuthNotice(window.location.search));
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

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit) return;
    setState({ status: "loading" });
    try {
      const res = await fetch("/api/workbench/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ask }),
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
      await loadRunHistory({ silent: true });
    } catch (err) {
      setState({
        status: "error",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  function handleOpenHistoryRun(run: WorkbenchRunHistoryRow) {
    setState({
      status: "loaded",
      response: toWorkbenchStartResponseFromHistoryRun(run),
    });
  }

  async function handleConfigSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSetupState({ status: "saving" });
    try {
      const res = await fetch("/api/workbench/config", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(buildWorkbenchConfigPayload(configForm)),
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
      setConfigForm(getInitialWorkbenchConfigForm(config));
      await loadConfig({ silent: true });
      setSetupState({ status: "saved" });
    } catch (err) {
      setSetupState({
        status: "error",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  async function handleCheck() {
    setSetupState({ status: "checking" });
    try {
      const res = await fetch("/api/workbench/check", {
        method: "GET",
        headers: { Accept: "application/json" },
      });
      const body = (await res.json().catch(() => null)) as
        | WorkbenchCheckResponse
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

      const payload = body as WorkbenchCheckResponse | null;
      setHealthRows(toWorkbenchHealthRows(payload));
      setHealthGeneratedAt(payload?.generated_at ?? null);
      setSetupState({ status: "idle" });
    } catch (err) {
      setSetupState({
        status: "error",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  async function handleConnectorManagementAction(
    action: WorkbenchConnectorManagementAction,
  ) {
    setConnectorManagementState({ status: "running", actionId: action.id });
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
        | WorkbenchConnectorManagementResponse
        | null;

      if (!res.ok) {
        const detail =
          body && body.detail
            ? body.detail
            : body && body.message
              ? body.message
              : body && body.error
                ? body.error
                : `HTTP ${res.status}`;
        throw new Error(detail);
      }

      const message =
        body?.message ??
        body?.reason ??
        `${action.label} request accepted.`;
      setConnectorManagementState({
        status: "loaded",
        actionId: action.id,
        message,
      });

      if (body?.next_url) {
        window.location.assign(body.next_url);
        return;
      }

      await loadConfig({ silent: true });
      await handleCheck();
    } catch (err) {
      setConnectorManagementState({
        status: "error",
        actionId: action.id,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  function handleNotionSetup() {
    window.location.assign(NOTION_SETUP_HREF);
  }

  return (
    <div
      style={{
        height: "calc(100vh - var(--shell-h))",
        display: "grid",
        gridTemplateColumns: "minmax(340px, 420px) minmax(0, 1fr)",
        minHeight: 0,
      }}
    >
      <section
        style={{
          borderRight: "1px solid var(--rule)",
          display: "flex",
          flexDirection: "column",
          minHeight: 0,
          background: "var(--panel)",
        }}
      >
        <header
          style={{
            padding: "20px 24px 16px",
            borderBottom: "1px solid var(--rule)",
          }}
        >
          <SectionEyebrow>Workbench</SectionEyebrow>
          <h1
            style={{
              margin: "8px 0 0",
              fontFamily: "var(--font-plex-serif)",
              fontSize: 34,
              lineHeight: 1.05,
              fontWeight: 400,
              letterSpacing: 0,
            }}
          >
            Pre-flight
          </h1>
        </header>

        <ConnectorReadinessPanel summary={connectorSummary} />

        <WorkbenchSetupPanel
          form={configForm}
          onFormChange={setConfigForm}
          onSave={handleConfigSave}
          onSetupNotion={handleNotionSetup}
          onCheck={handleCheck}
          onConnectorManagementAction={handleConnectorManagementAction}
          onConnectGoogle={() =>
            signIn("google", { callbackUrl: WORKBENCH_CALLBACK_URL })
          }
          setupState={setupState}
          connectorManagementState={connectorManagementState}
          setupAffordances={setupAffordances}
          setupSummary={setupSummary}
          oauthNotice={oauthNotice}
          healthRows={healthRows}
          healthGeneratedAt={healthGeneratedAt}
        />

        <RunHistoryPanel
          state={runHistoryState}
          selectedRunId={selectedRunId}
          onRefresh={() => loadRunHistory()}
          onOpenRun={handleOpenHistoryRun}
        />

        <form
          onSubmit={handleSubmit}
          style={{
            flex: 1,
            minHeight: 0,
            display: "flex",
            flexDirection: "column",
            gap: 14,
            padding: 24,
          }}
        >
          <label
            htmlFor="workbench-ask"
            style={{
              fontFamily: "var(--font-plex-mono)",
              fontSize: 10,
              letterSpacing: "0.14em",
              textTransform: "uppercase",
              color: "var(--ink-faint)",
            }}
          >
            Ask
          </label>
          <textarea
            id="workbench-ask"
            value={ask}
            onChange={(event) => setAsk(event.target.value)}
            placeholder="Paste ask"
            style={{
              flex: 1,
              minHeight: 260,
              resize: "none",
              width: "100%",
              padding: 14,
              border: "1px solid var(--rule)",
              background: "var(--bg)",
              color: "var(--ink)",
              fontFamily: "var(--font-plex-sans)",
              fontSize: 14,
              lineHeight: 1.5,
            }}
          />
          <button
            type="submit"
            disabled={!canSubmit}
            style={{
              alignSelf: "flex-start",
              padding: "10px 14px",
              border: "1px solid var(--ink)",
              background: canSubmit ? "var(--ink)" : "transparent",
              color: canSubmit ? "var(--bg)" : "var(--ink-dim)",
              fontFamily: "var(--font-plex-mono)",
              fontSize: 11,
              letterSpacing: "0.12em",
              textTransform: "uppercase",
            }}
          >
            Start
          </button>
        </form>
      </section>

      <section
        aria-live="polite"
        style={{
          minHeight: 0,
          overflow: "auto",
          padding: "22px 28px",
        }}
      >
        {state.status === "loaded" ? (
          <ResultView response={state.response} />
        ) : (
          <RunPaneStateView summary={runPaneSummary} />
        )}
      </section>
    </div>
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
  if (normalized.length <= maxLength) return normalized || "Empty ask";
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
    task.summary || "Workbench pre-flight result",
    `Deliverable: ${task.deliverable_type || "Not specified"}`,
    `Task type: ${task.task_type || "Not specified"}`,
    `Clarifying message: ${
      response.result.drafted_clarifying_message.trim() || "No message."
    }`,
  ].join("\n");
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

function ResultView({ response }: { response: WorkbenchStartResponse }) {
  const result = response.result;
  const invocation = response.invocation;
  const [postRunState, setPostRunState] = useState<PostRunState>({
    status: "idle",
  });
  const uiSummary = useMemo(() => deriveWorkbenchUiSummary(response), [response]);
  const postRunActions = useMemo(
    () => deriveWorkbenchPostRunActions(response),
    [response],
  );
  const meta = useMemo(
    () => [
      `task_type ${invocation.task_type}`,
      `skill ${invocation.skill_version ?? "unknown"}`,
      uiSummary.baselineLabel,
      `${uiSummary.sourceCount} source items`,
    ],
    [invocation, uiSummary.baselineLabel, uiSummary.sourceCount],
  );

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

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(4, minmax(140px, 1fr))",
          gap: 10,
        }}
      >
        <MetricTile label="Invocation" value={uiSummary.invocationState} />
        <MetricTile label="Retrieval" value={`${uiSummary.sourceCount} items`} />
        <MetricTile label="Baseline" value={uiSummary.baselineLabel} />
        <MetricTile label="Savings" value={uiSummary.hoursSavedLabel} />
      </div>

      <div
        style={{
          display: "flex",
          gap: 8,
          flexWrap: "wrap",
          alignItems: "center",
        }}
      >
        {meta.map((item) => (
          <span
            key={item}
            style={{
              border: "1px solid var(--rule)",
              padding: "5px 8px",
              color: "var(--ink-dim)",
              fontFamily: "var(--font-plex-mono)",
              fontSize: 10,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
            }}
          >
            {item}
          </span>
        ))}
      </div>

      <ResultSection title="Run Status">
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(3, minmax(150px, 1fr))",
            gap: 10,
          }}
        >
          <KeyValue label="State" value={uiSummary.invocationState} />
          <KeyValue label="Latency" value={formatLatency(invocation.latency_ms)} />
          <KeyValue label="Warnings" value={uiSummary.warningCount} />
          <KeyValue label="Skill" value={invocation.skill_version ?? "unknown"} />
          <KeyValue label="Before" value={uiSummary.baselineLabel} />
          <KeyValue label="After" value={uiSummary.workbenchLabel} />
        </div>
      </ResultSection>

      <PostRunActionPanel
        actions={postRunActions}
        state={postRunState}
        onAction={handlePostRunAction}
      />

      <ResultSection title="Retrieval Sources">
        <RetrievalStatusList rows={uiSummary.retrievalRows} />
      </ResultSection>

      <ResultSection title="Decoded Task">
        <KeyValue label="Summary" value={result.decoded_task.summary} />
        <KeyValue label="Requester" value={result.decoded_task.requester} />
        <KeyValue
          label="Deliverable"
          value={result.decoded_task.deliverable_type}
        />
        <KeyValue label="Task type" value={result.decoded_task.task_type} />
      </ResultSection>

      <ResultSection title="Missing Context">
        <MissingContextList items={result.missing_context} />
      </ResultSection>

      <ResultSection title="Clarifying Message">
        <TextBlock text={result.drafted_clarifying_message || "No message."} />
      </ResultSection>

      <ResultSection title="Retrieved Context">
        <RetrievedContextList items={result.retrieved_context} />
      </ResultSection>

      <ResultSection title="Suggested Approach">
        <ApproachList items={result.suggested_approach} />
      </ResultSection>

      <ResultSection title="Time Estimate">
        <KeyValue
          label="Before"
          value={`${result.time_estimate.estimated_before_minutes} minutes`}
        />
        <KeyValue
          label="With Workbench"
          value={
            result.time_estimate.estimated_workbench_minutes == null
              ? null
              : `${result.time_estimate.estimated_workbench_minutes} minutes`
          }
        />
      </ResultSection>

      <ResultSection title="Warnings">
        <SimpleList
          items={dedupeWarnings([
            ...result.warnings,
            ...(response.retrieval.warnings ?? []),
          ])}
          empty="No warnings."
        />
      </ResultSection>
    </div>
  );
}

function MetricTile({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        border: "1px solid var(--rule)",
        background: "var(--panel)",
        padding: "10px 12px",
        minHeight: 64,
      }}
    >
      <div
        style={{
          color: "var(--ink-faint)",
          fontFamily: "var(--font-plex-mono)",
          fontSize: 10,
          letterSpacing: "0.12em",
          textTransform: "uppercase",
        }}
      >
        {label}
      </div>
      <div
        style={{
          marginTop: 7,
          color: "var(--ink)",
          fontFamily: "var(--font-plex-mono)",
          fontSize: 13,
          lineHeight: 1.25,
          textTransform: label === "Invocation" ? "uppercase" : "none",
        }}
      >
        {value}
      </div>
    </div>
  );
}

function ResultSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section
      style={{
        borderTop: "1px solid var(--rule)",
        paddingTop: 14,
        display: "grid",
        gridTemplateColumns: "190px minmax(0, 1fr)",
        gap: 18,
      }}
    >
      <h2
        style={{
          margin: 0,
          fontFamily: "var(--font-plex-mono)",
          fontSize: 11,
          letterSpacing: "0.12em",
          textTransform: "uppercase",
          color: "var(--ink-faint)",
        }}
      >
        {title}
      </h2>
      <div style={{ minWidth: 0 }}>{children}</div>
    </section>
  );
}

function PostRunActionPanel({
  actions,
  state,
  onAction,
}: {
  actions: WorkbenchPostRunAction[];
  state: PostRunState;
  onAction: (action: WorkbenchPostRunAction) => void;
}) {
  if (actions.length === 0) return null;

  return (
    <ResultSection title="Post-run Actions">
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {actions.map((action) => {
          const running =
            state.status === "running" && state.actionId === action.id;
          const disabled = action.status === "disabled" || running;
          return (
            <div
              key={action.id}
              style={{
                border: "1px solid var(--rule)",
                padding: "10px 11px",
                display: "grid",
                gridTemplateColumns: "minmax(0, 1fr) auto",
                gap: 12,
                alignItems: "center",
              }}
            >
              <div style={{ minWidth: 0 }}>
                <div
                  style={{
                    color: "var(--ink)",
                    fontSize: 13,
                    lineHeight: 1.25,
                  }}
                >
                  {action.label}
                </div>
                <div
                  style={{
                    marginTop: 3,
                    color: "var(--ink-dim)",
                    fontSize: 12,
                    lineHeight: 1.35,
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
    </ResultSection>
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

function postRunButtonLabel(action: WorkbenchPostRunAction, running: boolean) {
  if (running) return action.id === "presend" ? "Preparing" : "Sending";
  if (action.status === "disabled") return "Disabled";
  if (action.id === "presend") return "Run";
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

function ConnectorReadinessPanel({
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

function WorkbenchSetupPanel({
  form,
  onFormChange,
  onSave,
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
  onFormChange: (form: WorkbenchConfigForm) => void;
  onSave: (event: FormEvent<HTMLFormElement>) => void;
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

  function updateField(field: keyof WorkbenchConfigForm, value: string) {
    onFormChange({ ...form, [field]: value });
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
            label="Voice"
            value={form.voice_register}
            onChange={(value) => updateField("voice_register", value)}
          />
          <SetupInput
            label="Feedback"
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
            Friction tasks
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
                  ? setupState.message
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
                {row.reason ?? "Clear"}
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
        <SectionEyebrow>Recent Runs</SectionEyebrow>
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
          No recent runs.
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
            {primaryActionRunning ? "Repairing" : affordance.buttonLabel}
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
      {state.message}
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

function MissingContextList({ items }: { items: WorkbenchMissingContext[] }) {
  if (items.length === 0) return <TextBlock text="No missing context flagged." />;
  return (
    <ol style={{ margin: 0, paddingLeft: 18 }}>
      {items.map((item, index) => (
        <li key={`${item.question}-${index}`} style={{ marginBottom: 8 }}>
          <span>{item.question}</span>
          {item.why ? (
            <div style={{ color: "var(--ink-dim)", fontSize: 13 }}>
              {item.why}
            </div>
          ) : null}
        </li>
      ))}
    </ol>
  );
}

function RetrievedContextList({ items }: { items: WorkbenchRetrievedContext[] }) {
  if (items.length === 0) {
    return <TextBlock text="No retrieved context returned." />;
  }
  return (
    <ul style={{ margin: 0, paddingLeft: 18 }}>
      {items.map((item, index) => (
        <li key={`${item.source_label}-${index}`} style={{ marginBottom: 10 }}>
          <span>{item.claim}</span>
          <div
            style={{
              marginTop: 3,
              color: "var(--ink-dim)",
              fontFamily: "var(--font-plex-mono)",
              fontSize: 11,
            }}
          >
            {item.source_type}:{" "}
            {item.source_url ? (
              <a href={item.source_url} target="_blank" rel="noreferrer">
                {item.source_label}
              </a>
            ) : (
              item.source_label
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}

function RetrievalStatusList({ rows }: { rows: WorkbenchRetrievalRow[] }) {
  if (rows.length === 0) {
    return <TextBlock text="No retrieval status returned." />;
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {rows.map((row) => (
        <div
          key={row.source}
          style={{
            border: "1px solid var(--rule)",
            padding: "9px 10px",
            display: "grid",
            gridTemplateColumns: "130px 120px 90px minmax(0, 1fr)",
            gap: 10,
            alignItems: "start",
            fontSize: 13,
          }}
        >
          <span style={{ fontFamily: "var(--font-plex-mono)" }}>
            {row.source}
          </span>
          <StatusPill status={row.status} />
          <span style={{ color: "var(--ink-dim)" }}>{row.itemsCount} items</span>
          <span style={{ color: "var(--ink-dim)" }}>
            {[row.reason, ...row.warnings].filter(Boolean).join(" | ") || "Clear"}
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
    normalized === "ready to run";
  const isWarn =
    normalized === "unavailable" ||
    normalized === "loading" ||
    normalized === "checking" ||
    normalized === "checking setup" ||
    normalized === "not connected" ||
    normalized === "finish setup" ||
    normalized === "repair setup" ||
    normalized === "reauth required" ||
    normalized === "resource missing" ||
    normalized === "repair available";
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

function ApproachList({ items }: { items: WorkbenchApproachStep[] }) {
  if (items.length === 0) return <TextBlock text="No approach returned." />;
  return (
    <ol style={{ margin: 0, paddingLeft: 18 }}>
      {items.map((item, index) => (
        <li key={`${item.step}-${index}`} style={{ marginBottom: 8 }}>
          <span>{item.step}</span>
          {item.rationale ? (
            <div style={{ color: "var(--ink-dim)", fontSize: 13 }}>
              {item.rationale}
            </div>
          ) : null}
        </li>
      ))}
    </ol>
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

function formatLatency(latencyMs: number | null) {
  if (latencyMs == null) return "Not recorded";
  if (latencyMs < 1000) return `${Math.round(latencyMs)}ms`;
  return `${(latencyMs / 1000).toFixed(1)}s`;
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
