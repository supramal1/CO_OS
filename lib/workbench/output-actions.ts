import type {
  WorkbenchConnectorAction,
  WorkbenchConnectorCheck,
} from "./connector-health";
import type { WorkbenchPresendSaveBackResult } from "./presend-types";
import type { WorkbenchUserConfig } from "./retrieval/types";
import type { WorkbenchStartResponse } from "./types";

export const WORKBENCH_OUTPUT_ACTIONS = [
  "copy_response",
  "save_to_drive",
  "save_to_notion",
  "feedback_useful",
  "feedback_not_useful",
] as const;

export type WorkbenchOutputAction = (typeof WORKBENCH_OUTPUT_ACTIONS)[number];
export type WorkbenchOutputActionMode = "client" | "server";
export type WorkbenchOutputActionTarget =
  | "clipboard"
  | "drive"
  | "notion"
  | "feedback";
export type WorkbenchOutputActionAvailabilityState =
  | "available"
  | "unavailable";

export type WorkbenchOutputActionReason =
  | "client_side_action"
  | "drive_ready"
  | "drive_readiness_unknown"
  | "drive_save_back_saved"
  | "drive_save_back_skipped"
  | "feedback_available"
  | "google_readiness_unavailable"
  | "missing_drive_folder"
  | "notion_save_back_not_supported_v1"
  | "run_failed"
  | "user_workbench_config_missing"
  | (string & {});

export type WorkbenchOutputActionContract = {
  action: WorkbenchOutputAction;
  label: string;
  mode: WorkbenchOutputActionMode;
  target: WorkbenchOutputActionTarget;
};

export type WorkbenchOutputActionAvailability =
  WorkbenchOutputActionContract & {
    availability: WorkbenchOutputActionAvailabilityState;
    reason: WorkbenchOutputActionReason;
    action_hint?: WorkbenchConnectorAction;
    save_back?: WorkbenchPresendSaveBackResult;
  };

export type WorkbenchOutputGoogleReadiness = {
  ready: boolean;
  status: string;
  blockers?: string[];
  missing_scopes?: string[];
};

export type WorkbenchOutputConnectorContext = {
  config?: Pick<
    WorkbenchUserConfig,
    "drive_folder_id" | "notion_parent_page_id"
  > | null;
  google_readiness?: WorkbenchOutputGoogleReadiness | null;
  checks?: WorkbenchConnectorCheck[] | null;
};

export type DeriveWorkbenchOutputActionsInput = {
  startResponse: WorkbenchStartResponse;
  connector?: WorkbenchOutputConnectorContext | null;
  saveBack?: WorkbenchPresendSaveBackResult | null;
};

export type WorkbenchOutputActionAcceptedReason =
  | "client_side_action"
  | "drive_save_back_contract_accepted"
  | "feedback_recorded"
  | "feedback_storage_unavailable";

export type WorkbenchOutputActionUnavailableReason =
  "notion_save_back_not_supported_v1";

export type WorkbenchOutputActionAcceptedOutcome = {
  action: Exclude<WorkbenchOutputAction, "save_to_notion">;
  status: "accepted";
  reason: WorkbenchOutputActionAcceptedReason;
  run_id?: string;
  persisted?: boolean;
  save_back?: WorkbenchPresendSaveBackResult;
};

export type WorkbenchOutputActionUnavailableOutcome = {
  action: "save_to_notion";
  status: "unavailable";
  reason: WorkbenchOutputActionUnavailableReason;
  run_id?: string;
};

export type WorkbenchOutputActionOutcome =
  | WorkbenchOutputActionAcceptedOutcome
  | WorkbenchOutputActionUnavailableOutcome;

const ACTION_CONTRACTS: Record<
  WorkbenchOutputAction,
  WorkbenchOutputActionContract
> = {
  copy_response: {
    action: "copy_response",
    label: "Copy response",
    mode: "client",
    target: "clipboard",
  },
  save_to_drive: {
    action: "save_to_drive",
    label: "Save to Drive",
    mode: "server",
    target: "drive",
  },
  save_to_notion: {
    action: "save_to_notion",
    label: "Save to Notion",
    mode: "server",
    target: "notion",
  },
  feedback_useful: {
    action: "feedback_useful",
    label: "Useful",
    mode: "server",
    target: "feedback",
  },
  feedback_not_useful: {
    action: "feedback_not_useful",
    label: "Not useful",
    mode: "server",
    target: "feedback",
  },
};

export function isWorkbenchOutputAction(
  action: unknown,
): action is WorkbenchOutputAction {
  return (
    typeof action === "string" &&
    WORKBENCH_OUTPUT_ACTIONS.includes(action as WorkbenchOutputAction)
  );
}

export function normalizeWorkbenchRunId(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

export function normalizeWorkbenchActionPayload(
  value: unknown,
): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

export function extractWorkbenchDriveSaveBack(
  payload: Record<string, unknown> | undefined,
): WorkbenchPresendSaveBackResult | undefined {
  const saveBack = payload?.save_back;
  if (!saveBack || typeof saveBack !== "object" || Array.isArray(saveBack)) {
    return undefined;
  }

  const candidate = saveBack as { status?: unknown; target?: unknown };
  if (
    typeof candidate.status !== "string" ||
    candidate.target !== "drive"
  ) {
    return undefined;
  }

  return saveBack as WorkbenchPresendSaveBackResult;
}

export function deriveWorkbenchOutputActions(
  input: DeriveWorkbenchOutputActionsInput,
): WorkbenchOutputActionAvailability[] {
  const runSucceeded = input.startResponse.invocation.status === "succeeded";

  return [
    runSucceeded
      ? available(ACTION_CONTRACTS.copy_response, "client_side_action")
      : unavailable(ACTION_CONTRACTS.copy_response, "run_failed"),
    runSucceeded
      ? deriveDriveAction(input.connector ?? null, input.saveBack ?? null)
      : unavailable(ACTION_CONTRACTS.save_to_drive, "run_failed"),
    unavailable(
      ACTION_CONTRACTS.save_to_notion,
      "notion_save_back_not_supported_v1",
    ),
    available(ACTION_CONTRACTS.feedback_useful, "feedback_available"),
    available(ACTION_CONTRACTS.feedback_not_useful, "feedback_available"),
  ];
}

export function buildCopyResponseOutcome(
  runId?: string,
): WorkbenchOutputActionAcceptedOutcome {
  return withRunId(
    {
      action: "copy_response",
      status: "accepted",
      reason: "client_side_action",
    },
    runId,
  );
}

export function buildSaveToDriveOutcome(input: {
  runId?: string;
  saveBack?: WorkbenchPresendSaveBackResult;
}): WorkbenchOutputActionAcceptedOutcome {
  return withRunId(
    {
      action: "save_to_drive",
      status: "accepted",
      reason: "drive_save_back_contract_accepted",
      ...(input.saveBack ? { save_back: input.saveBack } : {}),
    },
    input.runId,
  );
}

export function buildSaveToNotionOutcome(
  runId?: string,
): WorkbenchOutputActionUnavailableOutcome {
  return withRunId(
    {
      action: "save_to_notion",
      status: "unavailable",
      reason: "notion_save_back_not_supported_v1",
    },
    runId,
  );
}

export function buildFeedbackOutcome(input: {
  action: "feedback_useful" | "feedback_not_useful";
  runId?: string;
  persisted: boolean;
}): WorkbenchOutputActionAcceptedOutcome {
  return withRunId(
    {
      action: input.action,
      status: "accepted",
      reason: input.persisted
        ? "feedback_recorded"
        : "feedback_storage_unavailable",
      persisted: input.persisted,
    },
    input.runId,
  );
}

function deriveDriveAction(
  connector: WorkbenchOutputConnectorContext | null,
  saveBack: WorkbenchPresendSaveBackResult | null,
): WorkbenchOutputActionAvailability {
  const fromSaveBack = deriveDriveActionFromSaveBack(saveBack);
  if (fromSaveBack) return fromSaveBack;

  const driveCheck = connector?.checks?.find((check) => check.source === "drive");
  if (driveCheck) {
    if (driveCheck.status === "ready") {
      return available(ACTION_CONTRACTS.save_to_drive, "drive_ready");
    }
    return unavailable(
      ACTION_CONTRACTS.save_to_drive,
      driveCheck.reason ?? driveCheck.status,
      driveCheck.action,
    );
  }

  const config = connector?.config;
  if (config === null) {
    return unavailable(
      ACTION_CONTRACTS.save_to_drive,
      "user_workbench_config_missing",
    );
  }

  const driveFolderId = config?.drive_folder_id?.trim();
  if (config && !driveFolderId) {
    return unavailable(ACTION_CONTRACTS.save_to_drive, "missing_drive_folder");
  }

  const googleReadiness = connector?.google_readiness;
  if (googleReadiness && !googleReadiness.ready) {
    return unavailable(
      ACTION_CONTRACTS.save_to_drive,
      googleReadiness.status || "google_readiness_unavailable",
      googleReconsentAction(googleReadiness.status),
    );
  }

  if (driveFolderId && (googleReadiness?.ready ?? true)) {
    return available(ACTION_CONTRACTS.save_to_drive, "drive_ready");
  }

  return unavailable(
    ACTION_CONTRACTS.save_to_drive,
    "drive_readiness_unknown",
  );
}

function deriveDriveActionFromSaveBack(
  saveBack: WorkbenchPresendSaveBackResult | null,
): WorkbenchOutputActionAvailability | null {
  if (!saveBack) return null;

  if (saveBack.status === "saved") {
    return {
      ...ACTION_CONTRACTS.save_to_drive,
      availability: "available",
      reason: "drive_save_back_saved",
      save_back: saveBack,
    };
  }

  if (saveBack.status === "skipped") {
    return {
      ...ACTION_CONTRACTS.save_to_drive,
      availability: "unavailable",
      reason: "drive_save_back_skipped",
      save_back: saveBack,
    };
  }

  return {
    ...ACTION_CONTRACTS.save_to_drive,
    availability: "unavailable",
    reason: saveBack.reason,
    save_back: saveBack,
  };
}

function available(
  contract: WorkbenchOutputActionContract,
  reason: WorkbenchOutputActionReason,
): WorkbenchOutputActionAvailability {
  return { ...contract, availability: "available", reason };
}

function unavailable(
  contract: WorkbenchOutputActionContract,
  reason: WorkbenchOutputActionReason,
  actionHint?: WorkbenchConnectorAction,
): WorkbenchOutputActionAvailability {
  return {
    ...contract,
    availability: "unavailable",
    reason,
    ...(actionHint ? { action_hint: actionHint } : {}),
  };
}

function withRunId<T extends WorkbenchOutputActionOutcome>(
  outcome: T,
  runId?: string,
): T {
  return runId ? ({ ...outcome, run_id: runId } as T) : outcome;
}

function googleReconsentAction(
  status: string,
): WorkbenchConnectorAction | undefined {
  return [
    "grant_missing",
    "scope_missing",
    "token_missing",
    "token_lookup_unavailable",
    "google_access_token_missing",
    "google_refresh_token_missing",
    "google_calendar_access_token_missing",
    "google_reauth_required",
    "missing_access_token",
  ].includes(status)
    ? "google_reconsent"
    : undefined;
}
