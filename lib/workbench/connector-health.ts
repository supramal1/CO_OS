import { getWorkbenchGoogleAuthReadiness } from "./google-auth";
import {
  getWorkbenchGoogleAccessToken,
  type WorkbenchGoogleTokenStore,
} from "./google-token";
import { createWorkbenchGoogleTokenStore } from "./google-token-store";
import { createGoogleCalendarClient } from "./google-calendar";
import { getUserWorkbenchConfig } from "./retrieval/config";
import {
  WORKBENCH_NOTION_PAGE_NAMES,
  retrieveNotionContext,
} from "./retrieval/notion";
import type { WorkbenchUserConfig } from "./retrieval/types";
import type { WorkbenchCalendarClient } from "./calendar";

export type WorkbenchConnectorName =
  | "config"
  | "notion"
  | "google"
  | "calendar"
  | "drive";

export type WorkbenchConnectorStatus =
  | "ready"
  | "unavailable"
  | "error"
  | "reauth_required"
  | "resource_missing"
  | "repair_available";
export type WorkbenchConnectorAction = "google_reconsent";

export type WorkbenchConnectorCheck = {
  source: WorkbenchConnectorName;
  status: WorkbenchConnectorStatus;
  reason?: string;
  message?: string;
  blockers?: string[];
  action?: WorkbenchConnectorAction;
};

export type WorkbenchConnectorHealthResponse = {
  checks: WorkbenchConnectorCheck[];
  generated_at: string;
};

export type WorkbenchGoogleAccessTokenProviderResult =
  | string
  | null
  | undefined
  | {
      status: "available";
      accessToken?: string | null;
    }
  | {
      status: "unavailable";
      reason: string;
    };

export type WorkbenchGoogleAccessTokenProvider = (input: {
  userId: string;
  now?: Date;
}) => Promise<WorkbenchGoogleAccessTokenProviderResult>;

type CalendarClientFactoryResult =
  | {
      status: "available";
      client: WorkbenchCalendarClient;
    }
  | {
      status: "unavailable";
      reason: string;
      client?: null;
    };

export type WorkbenchConnectorHealthDependencies = {
  getUserConfig?: (userId: string) => Promise<WorkbenchUserConfig | null>;
  getGoogleReadiness?: typeof getWorkbenchGoogleAuthReadiness;
  retrieveNotionContext?: typeof retrieveNotionContext;
  googleAccessTokenProvider?: WorkbenchGoogleAccessTokenProvider;
  googleTokenStore?: WorkbenchGoogleTokenStore;
  createCalendarClient?: (input: {
    accessToken?: string | null;
    fetch?: typeof fetch;
  }) => CalendarClientFactoryResult;
  calendarFetch?: typeof fetch;
  checkDriveFolder?: typeof checkDriveFolderCapability;
  driveFetch?: typeof fetch;
};

export async function getWorkbenchConnectorHealth(input: {
  userId: string;
  now?: Date;
  deps?: WorkbenchConnectorHealthDependencies;
}): Promise<WorkbenchConnectorHealthResponse> {
  const now = input.now ?? new Date();
  const deps = input.deps ?? {};
  const getConfig = deps.getUserConfig ?? getUserWorkbenchConfig;
  const getReadiness = deps.getGoogleReadiness ?? getWorkbenchGoogleAuthReadiness;
  const getToken =
    deps.googleAccessTokenProvider ??
    createDefaultGoogleAccessTokenProvider(deps.googleTokenStore);

  let config: WorkbenchUserConfig | null = null;
  const configCheck = await checkConfig(input.userId, getConfig);
  if (configCheck.status === "ready") {
    config = await getConfig(input.userId);
  }

  const token = await getTokenForChecks(input.userId, now, getToken);
  const googleCheck = await checkGoogle(input.userId, getReadiness);

  const checks: WorkbenchConnectorCheck[] = [
    configCheck,
    await checkNotion(input.userId, config, deps),
    googleCheck,
    await checkCalendar(now, token, deps, googleCheck),
    await checkDrive(config, token, deps),
  ];

  return {
    checks,
    generated_at: now.toISOString(),
  };
}

export async function checkDriveFolderCapability(input: {
  driveFolderId?: string | null;
  accessToken?: string | null;
  fetch?: typeof fetch;
}): Promise<WorkbenchConnectorCheck> {
  const folderId = input.driveFolderId?.trim();
  if (!folderId) {
    return {
      source: "drive",
      status: "repair_available",
      reason: "missing_drive_folder",
      blockers: ["drive_folder_id_missing"],
    };
  }

  const accessToken = input.accessToken?.trim();
  if (!accessToken) {
    return {
      source: "drive",
      status: "reauth_required",
      reason: "missing_access_token",
      action: "google_reconsent",
    };
  }

  const url = new URL(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(folderId)}`,
  );
  url.searchParams.set("fields", "id,mimeType,capabilities(canAddChildren)");
  url.searchParams.set("supportsAllDrives", "true");

  const response = await (input.fetch ?? fetch)(url.toString(), {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    const message = await googleApiErrorMessage(response);
    if (response.status === 401) {
      return {
        source: "drive",
        status: "reauth_required",
        reason: "google_reauth_required",
        message,
        action: "google_reconsent",
      };
    }
    if (response.status === 403 || response.status === 404) {
      return {
        source: "drive",
        status: "resource_missing",
        reason:
          response.status === 404
            ? "drive_folder_missing"
            : "drive_folder_inaccessible",
        message,
      };
    }
    throw new Error(`Google Drive folder check failed: ${response.status}`);
  }

  const body = (await response.json()) as {
    mimeType?: unknown;
    capabilities?: { canAddChildren?: unknown };
  };
  if (body.mimeType !== "application/vnd.google-apps.folder") {
    return {
      source: "drive",
      status: "resource_missing",
      reason: "drive_target_not_folder",
    };
  }
  if (body.capabilities?.canAddChildren === false) {
    return {
      source: "drive",
      status: "resource_missing",
      reason: "drive_folder_not_writable",
    };
  }

  return { source: "drive", status: "ready" };
}

async function checkConfig(
  userId: string,
  getConfig: (userId: string) => Promise<WorkbenchUserConfig | null>,
): Promise<WorkbenchConnectorCheck> {
  try {
    const config = await getConfig(userId);
    return config
      ? { source: "config", status: "ready" }
      : {
          source: "config",
          status: "unavailable",
          reason: "user_workbench_config_missing",
        };
  } catch (error) {
    return {
      source: "config",
      status: "error",
      reason: "config_check_failed",
      message: errorMessage(error),
    };
  }
}

async function checkNotion(
  userId: string,
  config: WorkbenchUserConfig | null,
  deps: WorkbenchConnectorHealthDependencies,
): Promise<WorkbenchConnectorCheck> {
  if (!config) {
    return {
      source: "notion",
      status: "unavailable",
      reason: "user_workbench_config_missing",
    };
  }

  try {
    const result = await (deps.retrieveNotionContext ?? retrieveNotionContext)({
      ask: "Workbench connector health check",
      userId,
      config,
    });
    if (result.status.status === "ok") {
      const itemsCount = result.status.items_count ?? result.items.length;
      if (itemsCount < WORKBENCH_NOTION_PAGE_NAMES.length) {
        return {
          source: "notion",
          status: "repair_available",
          reason: "notion_child_pages_missing",
          blockers: ["notion_child_pages_missing"],
          message: `Expected ${WORKBENCH_NOTION_PAGE_NAMES.length} Notion child pages, found ${itemsCount}.`,
        };
      }
      return { source: "notion", status: "ready" };
    }
    if (result.status.status === "unavailable") {
      const check = classifyNotionUnavailable(result.status.reason);
      if (check) return check;
      return {
        source: "notion",
        status: "unavailable",
        reason: result.status.reason ?? "notion_unavailable",
      };
    }
    return (
      classifyNotionError(result.status.reason) ?? {
        source: "notion",
        status: "error",
        reason: "notion_check_failed",
        message: result.status.reason ?? "Notion check failed.",
      }
    );
  } catch (error) {
    const message = errorMessage(error);
    return classifyNotionError(message) ?? {
      source: "notion",
      status: "error",
      reason: "notion_check_failed",
      message,
    };
  }
}

async function checkGoogle(
  userId: string,
  getReadiness: typeof getWorkbenchGoogleAuthReadiness,
): Promise<WorkbenchConnectorCheck> {
  try {
    const readiness = await getReadiness(userId);
    if (readiness.ready) {
      return { source: "google", status: "ready" };
    }
    return {
      source: "google",
      status: googleReconsentAction(readiness.status)
        ? "reauth_required"
        : "unavailable",
      reason: readiness.status,
      blockers: readiness.blockers,
      action: googleReconsentAction(readiness.status),
    };
  } catch (error) {
    return {
      source: "google",
      status: "error",
      reason: "google_check_failed",
      message: errorMessage(error),
    };
  }
}

async function checkCalendar(
  now: Date,
  token: { accessToken: string | null; reason?: string; error?: string },
  deps: WorkbenchConnectorHealthDependencies,
  googleCheck?: WorkbenchConnectorCheck,
): Promise<WorkbenchConnectorCheck> {
  if (googleCheck?.action === "google_reconsent") {
    return {
      source: "calendar",
      status: "reauth_required",
      reason: googleCheck.blockers?.[0] ?? googleCheck.reason,
      action: "google_reconsent",
    };
  }

  if (token.error) {
    return {
      source: "calendar",
      status: "error",
      reason: "google_access_token_error",
      message: token.error,
    };
  }
  if (!token.accessToken) {
    return {
      source: "calendar",
      status: googleReconsentAction(token.reason ?? "")
        ? "reauth_required"
        : "unavailable",
      reason: token.reason ?? "missing_access_token",
      action: googleReconsentAction(token.reason ?? ""),
    };
  }

  try {
    const factory = deps.createCalendarClient ?? createGoogleCalendarClient;
    const client = factory({
      accessToken: token.accessToken,
      fetch: deps.calendarFetch,
    });
    if (client.status === "unavailable") {
      return {
        source: "calendar",
        status: googleReconsentAction(client.reason)
          ? "reauth_required"
          : "unavailable",
        reason: client.reason,
        action: googleReconsentAction(client.reason),
      };
    }

    await client.client.searchEvents({
      timeMin: now.toISOString(),
      timeMax: new Date(now.getTime() + 5 * 60 * 1000).toISOString(),
      query: "workbench-health-check",
    });
    return { source: "calendar", status: "ready" };
  } catch (error) {
    return {
      source: "calendar",
      status: "error",
      reason: "calendar_check_failed",
      message: errorMessage(error),
    };
  }
}

async function checkDrive(
  config: WorkbenchUserConfig | null,
  token: { accessToken: string | null; reason?: string; error?: string },
  deps: WorkbenchConnectorHealthDependencies,
): Promise<WorkbenchConnectorCheck> {
  if (!config) {
    return {
      source: "drive",
      status: "unavailable",
      reason: "user_workbench_config_missing",
    };
  }
  if (!config.drive_folder_id?.trim()) {
    return {
      source: "drive",
      status: "repair_available",
      reason: "missing_drive_folder",
      blockers: ["drive_folder_id_missing"],
    };
  }
  if (token.error) {
    return {
      source: "drive",
      status: "error",
      reason: "google_access_token_error",
      message: token.error,
    };
  }
  if (!token.accessToken) {
    return {
      source: "drive",
      status: googleReconsentAction(token.reason ?? "")
        ? "reauth_required"
        : "unavailable",
      reason: token.reason ?? "missing_access_token",
      action: googleReconsentAction(token.reason ?? ""),
    };
  }

  try {
    return await (deps.checkDriveFolder ?? checkDriveFolderCapability)({
      driveFolderId: config.drive_folder_id,
      accessToken: token.accessToken,
      fetch: deps.driveFetch,
    });
  } catch (error) {
    return {
      source: "drive",
      status: "error",
      reason: "drive_check_failed",
      message: errorMessage(error),
    };
  }
}

async function getTokenForChecks(
  userId: string,
  now: Date,
  getToken: WorkbenchGoogleAccessTokenProvider,
): Promise<{ accessToken: string | null; reason?: string; error?: string }> {
  try {
    const result = await getToken({ userId, now });
    if (typeof result === "string") return { accessToken: result.trim() || null };
    if (!result) return { accessToken: null };
    if (result.status === "unavailable") {
      return { accessToken: null, reason: result.reason };
    }
    return { accessToken: result.accessToken?.trim() || null };
  } catch (error) {
    return { accessToken: null, error: errorMessage(error) };
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

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function classifyNotionUnavailable(
  reason: string | undefined,
): WorkbenchConnectorCheck | null {
  if (!reason) return null;
  if (reason === "notion_parent_page_id_missing") {
    return {
      source: "notion",
      status: "repair_available",
      reason,
      blockers: ["notion_parent_page_id_missing"],
    };
  }

  return classifyNotionError(reason);
}

function classifyNotionError(
  message: string | undefined,
): WorkbenchConnectorCheck | null {
  if (!message) return null;
  if (/status 401\b/i.test(message) || /unauthorized|invalid token/i.test(message)) {
    return {
      source: "notion",
      status: "reauth_required",
      reason: "notion_reauth_required",
      message,
    };
  }
  if (
    /status (403|404)\b/i.test(message) ||
    /restricted_resource|object_not_found/i.test(message)
  ) {
    return {
      source: "notion",
      status: "resource_missing",
      reason: "notion_parent_page_missing",
      message,
    };
  }

  return null;
}

async function googleApiErrorMessage(
  response: Response,
): Promise<string | undefined> {
  try {
    const body = (await response.json()) as {
      error?: { message?: unknown };
      message?: unknown;
    };
    const message = body.error?.message ?? body.message;
    return typeof message === "string" && message.trim()
      ? message.trim()
      : undefined;
  } catch {
    return undefined;
  }
}

function googleReconsentAction(status: string): WorkbenchConnectorAction | undefined {
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
