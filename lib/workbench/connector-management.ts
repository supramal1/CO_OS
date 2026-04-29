import {
  getWorkbenchConnectorHealth,
  type WorkbenchConnectorCheck,
  type WorkbenchConnectorHealthResponse,
  type WorkbenchGoogleAccessTokenProvider,
} from "./connector-health";
import { getWorkbenchGoogleAuthReadiness } from "./google-auth";
import {
  ensureWorkbenchDriveSetup,
  type WorkbenchDriveSetupResult,
  type WorkbenchDriveSetupUpdate,
} from "./google-drive-setup";
import {
  getWorkbenchGoogleAccessToken,
  type WorkbenchGoogleTokenStore,
} from "./google-token";
import { createWorkbenchGoogleTokenStore } from "./google-token-store";
import {
  ensureWorkbenchNotionSetup,
  type WorkbenchNotionSetupReport,
} from "./notion-setup";
import {
  createWorkbenchNotionTokenStore,
  type WorkbenchNotionTokenStore,
} from "./notion-token-store";
import { getUserWorkbenchConfig } from "./retrieval/config";
import type { WorkbenchUserConfig } from "./retrieval/types";
import {
  patchWorkbenchUserConfig,
  type WorkbenchConfigResult,
  type WorkbenchUserConfigPatchInput,
} from "./user-config";

export const WORKBENCH_MANAGED_CONNECTOR_SOURCES = [
  "notion",
  "google_workspace",
] as const;

export const WORKBENCH_CONNECTOR_MANAGEMENT_ACTIONS = [
  "status",
  "repair",
  "disconnect",
] as const;

const NOTION_REPAIR_URL = "/api/workbench/notion/start";
const GOOGLE_REPAIR_URL = "/api/auth/signin/google?callbackUrl=%2Fworkbench";
const TOKEN_REVOCATION_UNSUPPORTED_REASON = "token_revocation_not_supported_v1";

export type WorkbenchManagedConnectorSource =
  (typeof WORKBENCH_MANAGED_CONNECTOR_SOURCES)[number];

export type WorkbenchConnectorManagementAction =
  (typeof WORKBENCH_CONNECTOR_MANAGEMENT_ACTIONS)[number];

export type WorkbenchConnectorManagementResponseAction =
  | WorkbenchConnectorManagementAction
  | "repair_redirect";

export type WorkbenchConnectorManagementStatus =
  | "ready"
  | "accepted"
  | "reauth_required"
  | "repair_available"
  | "resource_missing"
  | "unavailable"
  | "error";

export type WorkbenchConnectorManagementResponse = {
  source: WorkbenchManagedConnectorSource;
  status: WorkbenchConnectorManagementStatus;
  action: WorkbenchConnectorManagementResponseAction;
  next_url?: string;
  message?: string;
  reason?: string;
};

export type WorkbenchConnectorManagementDependencies = {
  getHealth?: (input: {
    userId: string;
  }) => Promise<WorkbenchConnectorHealthResponse>;
  getConfig?: (userId: string) => Promise<WorkbenchUserConfig | null>;
  patchConfig?: (
    userId: string,
    patch: WorkbenchUserConfigPatchInput,
  ) => Promise<WorkbenchConfigResult>;
  notionTokenStore?: WorkbenchNotionTokenStore;
  ensureNotionSetup?: typeof ensureWorkbenchNotionSetup;
  getGoogleReadiness?: typeof getWorkbenchGoogleAuthReadiness;
  googleAccessTokenProvider?: WorkbenchGoogleAccessTokenProvider;
  googleTokenStore?: WorkbenchGoogleTokenStore;
  ensureDriveSetup?: typeof ensureWorkbenchDriveSetup;
};

export function normalizeWorkbenchConnectorSource(
  source: string | null | undefined,
): WorkbenchManagedConnectorSource | null {
  switch (source?.trim()) {
    case "notion":
      return "notion";
    case "google":
    case "google-workspace":
    case "google_workspace":
    case "googleWorkspace":
      return "google_workspace";
    default:
      return null;
  }
}

export function isWorkbenchConnectorManagementAction(
  action: unknown,
): action is WorkbenchConnectorManagementAction {
  return (
    typeof action === "string" &&
    WORKBENCH_CONNECTOR_MANAGEMENT_ACTIONS.includes(
      action as WorkbenchConnectorManagementAction,
    )
  );
}

export async function listWorkbenchConnectorManagementStatuses(input: {
  userId: string;
  deps?: WorkbenchConnectorManagementDependencies;
}): Promise<WorkbenchConnectorManagementResponse[]> {
  const deps = input.deps ?? {};
  const getHealth = deps.getHealth ?? getWorkbenchConnectorHealth;
  const health = await getHealth({ userId: input.userId });
  return [
    mapNotionStatus(health.checks),
    mapGoogleWorkspaceStatus(health.checks),
  ];
}

export async function getWorkbenchConnectorManagementStatus(input: {
  userId: string;
  source: WorkbenchManagedConnectorSource;
  deps?: WorkbenchConnectorManagementDependencies;
}): Promise<WorkbenchConnectorManagementResponse> {
  const deps = input.deps ?? {};
  const getHealth = deps.getHealth ?? getWorkbenchConnectorHealth;
  const health = await getHealth({ userId: input.userId });
  return input.source === "notion"
    ? mapNotionStatus(health.checks)
    : mapGoogleWorkspaceStatus(health.checks);
}

export async function manageWorkbenchConnector(input: {
  userId: string;
  source: WorkbenchManagedConnectorSource;
  action: WorkbenchConnectorManagementAction;
  requestUrl?: string;
  deps?: WorkbenchConnectorManagementDependencies;
}): Promise<WorkbenchConnectorManagementResponse> {
  if (input.action === "status") {
    return getWorkbenchConnectorManagementStatus(input);
  }

  if (input.action === "disconnect") {
    return input.source === "notion"
      ? disconnectNotion(input)
      : disconnectGoogleWorkspace(input);
  }

  return input.source === "notion"
    ? repairNotion(input)
    : repairGoogleWorkspace(input);
}

async function repairNotion(input: {
  userId: string;
  deps?: WorkbenchConnectorManagementDependencies;
}): Promise<WorkbenchConnectorManagementResponse> {
  const deps = input.deps ?? {};
  const tokenStore = deps.notionTokenStore ?? createWorkbenchNotionTokenStore();
  let accessToken: string | null = null;

  try {
    const stored = await tokenStore.get(input.userId);
    accessToken = stored?.accessToken?.trim() || null;
  } catch (error) {
    return {
      source: "notion",
      status: "error",
      action: "repair",
      reason: "notion_token_lookup_failed",
      message: errorMessage(error),
    };
  }

  if (!accessToken) return notionRepairRedirect();

  const getConfig = deps.getConfig ?? getUserWorkbenchConfig;
  const ensureSetup = deps.ensureNotionSetup ?? ensureWorkbenchNotionSetup;

  try {
    const setup = await ensureSetup({
      userId: input.userId,
      config: await getConfig(input.userId),
      token: accessToken,
      updateConfig: async (update) => {
        await patchConfigOrThrow(deps, update.userId, {
          notion_parent_page_id: update.notion_parent_page_id,
        });
      },
    });

    if (setup.status === "failed") return notionSetupFailed(setup);

    return {
      source: "notion",
      status: "ready",
      action: "repair",
      message: "Notion workspace ready.",
      reason: setup.status,
    };
  } catch (error) {
    return {
      source: "notion",
      status: "error",
      action: "repair",
      reason: "notion_repair_failed",
      message: errorMessage(error),
    };
  }
}

async function repairGoogleWorkspace(input: {
  userId: string;
  deps?: WorkbenchConnectorManagementDependencies;
}): Promise<WorkbenchConnectorManagementResponse> {
  const deps = input.deps ?? {};
  const getReadiness = deps.getGoogleReadiness ?? getWorkbenchGoogleAuthReadiness;
  const readiness = await getReadiness(input.userId);
  if (!readiness.ready) {
    return googleRepairRedirect(readiness.status);
  }

  const token = await getGoogleAccessTokenForRepair(input.userId, deps);
  if (token.status === "redirect") {
    return googleRepairRedirect(token.reason);
  }
  if (token.status === "error") {
    return {
      source: "google_workspace",
      status: "error",
      action: "repair",
      reason: token.reason,
      message: token.message,
    };
  }

  const getConfig = deps.getConfig ?? getUserWorkbenchConfig;
  const ensureDriveSetup = deps.ensureDriveSetup ?? ensureWorkbenchDriveSetup;

  try {
    const drive = await ensureDriveSetup({
      userId: input.userId,
      config: await getConfig(input.userId),
      accessToken: token.accessToken,
      updateConfig: async (update: WorkbenchDriveSetupUpdate) => {
        await patchConfigOrThrow(deps, update.userId, {
          drive_folder_id: update.drive_folder_id,
          drive_folder_url: update.drive_folder_url,
        });
      },
    });

    if (drive.status === "unavailable") return googleRepairRedirect(drive.reason);

    return googleDriveReady(drive);
  } catch (error) {
    return {
      source: "google_workspace",
      status: "error",
      action: "repair",
      reason: "google_workspace_repair_failed",
      message: errorMessage(error),
    };
  }
}

async function disconnectNotion(input: {
  userId: string;
  deps?: WorkbenchConnectorManagementDependencies;
}): Promise<WorkbenchConnectorManagementResponse> {
  const patch = await patchConfig(input.deps, input.userId, {
    notion_parent_page_id: null,
  });
  if (patch) return patch;

  return {
    source: "notion",
    status: "accepted",
    action: "disconnect",
    message: "Notion config disconnected.",
    reason: TOKEN_REVOCATION_UNSUPPORTED_REASON,
  };
}

async function disconnectGoogleWorkspace(input: {
  userId: string;
  deps?: WorkbenchConnectorManagementDependencies;
}): Promise<WorkbenchConnectorManagementResponse> {
  const patch = await patchConfig(input.deps, input.userId, {
    drive_folder_id: null,
    drive_folder_url: null,
    google_oauth_grant_status: "revoked",
    google_oauth_scopes: [],
  });
  if (patch) return patch;

  return {
    source: "google_workspace",
    status: "accepted",
    action: "disconnect",
    message: "Google Workspace config disconnected.",
    reason: TOKEN_REVOCATION_UNSUPPORTED_REASON,
  };
}

function mapNotionStatus(
  checks: WorkbenchConnectorCheck[],
): WorkbenchConnectorManagementResponse {
  const check = checks.find((item) => item.source === "notion");
  if (!check) {
    return {
      source: "notion",
      status: "unavailable",
      action: "status",
      reason: "notion_health_missing",
    };
  }

  return {
    source: "notion",
    status: check.status,
    action: "status",
    reason: check.reason,
    message: check.message,
    next_url:
      check.status === "reauth_required" ? NOTION_REPAIR_URL : undefined,
  };
}

function mapGoogleWorkspaceStatus(
  checks: WorkbenchConnectorCheck[],
): WorkbenchConnectorManagementResponse {
  const relevant = checks.filter((item) =>
    ["google", "calendar", "drive"].includes(item.source),
  );
  if (relevant.length === 0) {
    return {
      source: "google_workspace",
      status: "unavailable",
      action: "status",
      reason: "google_workspace_health_missing",
    };
  }
  if (relevant.every((item) => item.status === "ready")) {
    return { source: "google_workspace", status: "ready", action: "status" };
  }

  const check =
    firstByStatus(relevant, "error") ??
    firstByStatus(relevant, "reauth_required") ??
    firstByStatus(relevant, "resource_missing") ??
    firstByStatus(relevant, "repair_available") ??
    firstByStatus(relevant, "unavailable") ??
    relevant[0];

  const status = check?.status === "ready" ? "unavailable" : check?.status;
  return {
    source: "google_workspace",
    status: status ?? "unavailable",
    action: "status",
    reason: check?.reason,
    message: googleWorkspaceStatusMessage(check),
    next_url:
      status === "reauth_required" ? GOOGLE_REPAIR_URL : undefined,
  };
}

function firstByStatus(
  checks: WorkbenchConnectorCheck[],
  status: WorkbenchConnectorManagementStatus,
): WorkbenchConnectorCheck | undefined {
  return checks.find((item) => item.status === status);
}

function googleWorkspaceStatusMessage(
  check: WorkbenchConnectorCheck | undefined,
): string | undefined {
  if (!check) return undefined;
  if (check.source === "drive" && check.status === "repair_available") {
    return "Drive folder needs repair.";
  }
  if (check.status === "reauth_required") {
    return "Reconnect Google Workspace.";
  }
  return check.message;
}

function notionRepairRedirect(): WorkbenchConnectorManagementResponse {
  return {
    source: "notion",
    status: "reauth_required",
    action: "repair_redirect",
    next_url: NOTION_REPAIR_URL,
    message: "Connect Notion to repair Workbench pages.",
    reason: "notion_oauth_required",
  };
}

function googleRepairRedirect(
  reason: string,
): WorkbenchConnectorManagementResponse {
  return {
    source: "google_workspace",
    status: "reauth_required",
    action: "repair_redirect",
    next_url: GOOGLE_REPAIR_URL,
    message: "Reconnect Google Workspace to repair Drive and Calendar.",
    reason,
  };
}

function notionSetupFailed(
  setup: Extract<WorkbenchNotionSetupReport, { status: "failed" }>,
): WorkbenchConnectorManagementResponse {
  if (/token|unauthorized|status 401/i.test(setup.reason)) {
    return notionRepairRedirect();
  }
  return {
    source: "notion",
    status: "error",
    action: "repair",
    reason: "notion_repair_failed",
    message: setup.reason,
  };
}

function googleDriveReady(
  drive: Extract<WorkbenchDriveSetupResult, { status: "ready" }>,
): WorkbenchConnectorManagementResponse {
  return {
    source: "google_workspace",
    status: "ready",
    action: "repair",
    message: "Google Workspace ready.",
    reason: drive.reason,
  };
}

async function getGoogleAccessTokenForRepair(
  userId: string,
  deps: WorkbenchConnectorManagementDependencies,
): Promise<
  | { status: "available"; accessToken: string }
  | { status: "redirect"; reason: string }
  | { status: "error"; reason: string; message: string }
> {
  const provider =
    deps.googleAccessTokenProvider ??
    createDefaultGoogleAccessTokenProvider(deps.googleTokenStore);

  try {
    const result = await provider({ userId });
    if (typeof result === "string") {
      const accessToken = result.trim();
      return accessToken
        ? { status: "available", accessToken }
        : { status: "redirect", reason: "google_access_token_missing" };
    }
    if (!result) return { status: "redirect", reason: "google_access_token_missing" };
    if (result.status === "unavailable") {
      return { status: "redirect", reason: result.reason };
    }
    const accessToken = result.accessToken?.trim();
    return accessToken
      ? { status: "available", accessToken }
      : { status: "redirect", reason: "google_access_token_missing" };
  } catch (error) {
    return {
      status: "error",
      reason: "google_access_token_lookup_failed",
      message: errorMessage(error),
    };
  }
}

function createDefaultGoogleAccessTokenProvider(
  tokenStore?: WorkbenchGoogleTokenStore,
): WorkbenchGoogleAccessTokenProvider {
  return async ({ userId, now }) => {
    const result = await getWorkbenchGoogleAccessToken({
      principalId: userId,
      now,
      tokenStore: tokenStore ?? createWorkbenchGoogleTokenStore(),
    });
    if (result.status === "available") {
      return { status: "available", accessToken: result.accessToken };
    }
    if (result.status === "unavailable") {
      return { status: "unavailable", reason: result.reason };
    }
    throw new Error(`${result.reason}: ${result.message}`);
  };
}

async function patchConfig(
  deps: WorkbenchConnectorManagementDependencies | undefined,
  userId: string,
  patch: WorkbenchUserConfigPatchInput,
): Promise<WorkbenchConnectorManagementResponse | null> {
  try {
    const result = await (deps?.patchConfig ?? patchWorkbenchUserConfig)(
      userId,
      patch,
    );
    if (result.status === "ok") return null;
    return {
      source: "google_oauth_grant_status" in patch ? "google_workspace" : "notion",
      status: result.status === "unavailable" ? "unavailable" : "error",
      action: "disconnect",
      reason: result.error,
      message: result.status === "error" ? result.detail : undefined,
    };
  } catch (error) {
    return {
      source: "google_oauth_grant_status" in patch ? "google_workspace" : "notion",
      status: "error",
      action: "disconnect",
      reason: "workbench_config_patch_failed",
      message: errorMessage(error),
    };
  }
}

async function patchConfigOrThrow(
  deps: WorkbenchConnectorManagementDependencies,
  userId: string,
  patch: WorkbenchUserConfigPatchInput,
): Promise<void> {
  const result = await (deps.patchConfig ?? patchWorkbenchUserConfig)(
    userId,
    patch,
  );
  if (result.status === "ok") return;
  throw new Error(result.status === "unavailable" ? result.error : result.detail);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
