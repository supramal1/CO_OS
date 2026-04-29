import { retrieveCalendarContext } from "./calendar";
import { getUserWorkbenchConfig } from "./config";
import { retrieveCornerstoneContext } from "./cornerstone";
import { retrieveNotionContext } from "./notion";
import { createGoogleCalendarClient } from "../google-calendar";
import {
  getWorkbenchGoogleAccessToken,
  type WorkbenchGoogleTokenStore,
} from "../google-token";
import { createWorkbenchGoogleTokenStore } from "../google-token-store";
import type { WorkbenchNotionTokenStore } from "../notion-token-store";
import type {
  WorkbenchRetrievalAdapterResult,
  WorkbenchRetrievalResult,
  WorkbenchRetrievalSourceResult,
  WorkbenchRetrievalSource,
  WorkbenchRetrievalStatus,
  WorkbenchUserConfig,
} from "./types";
import type { WorkbenchCalendarClient } from "../calendar";

export type WorkbenchRetrievalAdapters = {
  cornerstone?: () => Promise<AdapterReturn>;
  notion?: () => Promise<AdapterReturn>;
  calendar?: () => Promise<AdapterReturn>;
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

type LegacyAdapterReturn = {
  source: WorkbenchRetrievalSource;
  status: "available" | "unavailable" | "error";
  items: WorkbenchRetrievalAdapterResult["items"];
  warnings: string[];
};

type AdapterReturn = WorkbenchRetrievalAdapterResult | LegacyAdapterReturn;

export type GatherWorkbenchRetrievalInput = {
  ask: string;
  userId: string;
  apiKey: string;
  config?: WorkbenchUserConfig | null;
  now?: Date;
  adapters?: WorkbenchRetrievalAdapters;
  googleAccessTokenProvider?: WorkbenchGoogleAccessTokenProvider;
  googleTokenStore?: WorkbenchGoogleTokenStore;
  notionTokenStore?: WorkbenchNotionTokenStore | null;
  calendarFetch?: typeof fetch;
  calendarId?: string;
};

export async function gatherWorkbenchRetrieval(
  input: GatherWorkbenchRetrievalInput,
): Promise<WorkbenchRetrievalResult> {
  const config =
    input.config === undefined
      ? await getUserWorkbenchConfig(input.userId)
      : input.config;

  const [cornerstone, notion, calendar] = await Promise.all([
    invokeAdapter(
      "cornerstone",
      input.adapters?.cornerstone ??
        (() => retrieveCornerstoneContext({ ask: input.ask, apiKey: input.apiKey })),
    ),
    invokeAdapter(
      "notion",
      input.adapters?.notion ??
        (() =>
          retrieveNotionContext({
            ask: input.ask,
            userId: input.userId,
            config,
            notionTokenStore: input.notionTokenStore,
          })),
    ),
    invokeAdapter(
      "calendar",
      input.adapters?.calendar ??
        (() =>
          retrieveCalendarWithRuntime({
            ask: input.ask,
            userId: input.userId,
            config,
            now: input.now,
            googleAccessTokenProvider: input.googleAccessTokenProvider,
            googleTokenStore: input.googleTokenStore,
            calendarFetch: input.calendarFetch,
            calendarId: input.calendarId,
          })),
    ),
  ]);
  const sources = [
    toSourceResult("cornerstone", cornerstone),
    toSourceResult("notion", notion),
    toSourceResult("calendar", calendar),
  ];

  return {
    context: [...cornerstone.items, ...notion.items, ...calendar.items],
    statuses: [cornerstone.status, notion.status, calendar.status],
    sources,
    warnings: sources.flatMap((source) => source.warnings),
    generated_at: (input.now ?? new Date()).toISOString(),
  };
}

async function retrieveCalendarWithRuntime(input: {
  ask: string;
  userId: string;
  config: WorkbenchUserConfig | null;
  now?: Date;
  googleAccessTokenProvider?: WorkbenchGoogleAccessTokenProvider;
  googleTokenStore?: WorkbenchGoogleTokenStore;
  calendarFetch?: typeof fetch;
  calendarId?: string;
}): Promise<WorkbenchRetrievalAdapterResult> {
  const clientResult = await getCalendarClient({
    userId: input.userId,
    config: input.config,
    now: input.now,
    googleAccessTokenProvider: input.googleAccessTokenProvider,
    googleTokenStore: input.googleTokenStore,
    calendarFetch: input.calendarFetch,
    calendarId: input.calendarId,
  });

  if (clientResult.status === "unavailable") {
    return {
      items: [],
      status: {
        source: "calendar",
        status: "unavailable",
        reason: clientResult.reason,
        items_count: 0,
      },
    };
  }

  return retrieveCalendarContext({
    ask: input.ask,
    now: input.now,
    client: clientResult.client,
  });
}

async function getCalendarClient(input: {
  userId: string;
  config: WorkbenchUserConfig | null;
  now?: Date;
  googleAccessTokenProvider?: WorkbenchGoogleAccessTokenProvider;
  googleTokenStore?: WorkbenchGoogleTokenStore;
  calendarFetch?: typeof fetch;
  calendarId?: string;
}): Promise<
  | { status: "available"; client: WorkbenchCalendarClient }
  | { status: "unavailable"; reason: string }
> {
  const grant = validateCalendarGrant(input.config);
  if (grant.status === "unavailable") {
    return { status: "unavailable", reason: grant.reason };
  }

  const tokenProvider =
    input.googleAccessTokenProvider ??
    createDefaultGoogleAccessTokenProvider(input.googleTokenStore);

  let tokenResult: WorkbenchGoogleAccessTokenProviderResult;
  try {
    tokenResult = await tokenProvider({
      userId: input.userId,
      now: input.now,
    });
  } catch (error) {
    const unavailableReason = googleTokenUnavailableReasonFromError(error);
    if (unavailableReason) {
      return { status: "unavailable", reason: unavailableReason };
    }
    throw error;
  }

  const token = normalizeAccessToken(tokenResult);
  if (!token.accessToken) {
    return {
      status: "unavailable",
      reason: token.reason ?? "google_calendar_access_token_missing",
    };
  }

  const clientResult = createGoogleCalendarClient({
    accessToken: token.accessToken,
    calendarId: input.calendarId,
    fetch: input.calendarFetch,
  });
  if (clientResult.status === "unavailable") {
    return { status: "unavailable", reason: clientResult.reason };
  }

  return { status: "available", client: clientResult.client };
}

function validateCalendarGrant(
  config: WorkbenchUserConfig | null,
): { status: "available" } | { status: "unavailable"; reason: string } {
  if (config?.google_oauth_grant_status !== "granted") {
    return { status: "unavailable", reason: "google_oauth_grant_not_active" };
  }
  if (
    !(config.google_oauth_scopes ?? []).includes(
      "https://www.googleapis.com/auth/calendar.readonly",
    )
  ) {
    return { status: "unavailable", reason: "google_calendar_scope_missing" };
  }
  return { status: "available" };
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

function normalizeAccessToken(
  result: WorkbenchGoogleAccessTokenProviderResult,
): { accessToken: string | null; reason?: string } {
  if (typeof result === "string") {
    return { accessToken: result.trim() || null };
  }
  if (!result) {
    return { accessToken: null };
  }
  if (result.status === "unavailable") {
    return { accessToken: null, reason: result.reason };
  }
  return { accessToken: result.accessToken?.trim() || null };
}

async function invokeAdapter(
  source: WorkbenchRetrievalSource,
  adapter: () => Promise<AdapterReturn>,
): Promise<WorkbenchRetrievalAdapterResult> {
  try {
    return normalizeAdapterReturn(source, await adapter());
  } catch (err) {
    const reason = `${source} retrieval failed: ${
      err instanceof Error ? err.message : String(err)
    }`;
    return {
      items: [],
      status: {
        source,
        status: "error",
        reason,
        items_count: 0,
      },
    };
  }
}

function normalizeAdapterReturn(
  source: WorkbenchRetrievalSource,
  result: AdapterReturn,
): WorkbenchRetrievalAdapterResult {
  if (typeof result.status === "object") {
    return { ...result, warnings: uniqueWarnings(result.warnings ?? []) };
  }
  const status: WorkbenchRetrievalStatus = {
    source,
    status: result.status === "available" ? "ok" : result.status,
    reason: result.warnings[0],
    items_count: result.items.length,
  };
  return { items: result.items, status, warnings: uniqueWarnings(result.warnings) };
}

function toSourceResult(
  source: WorkbenchRetrievalSource,
  result: WorkbenchRetrievalAdapterResult,
): WorkbenchRetrievalSourceResult {
  const status =
    result.status.status === "ok" ? "available" : result.status.status;
  return {
    source,
    status,
    items: result.items,
    warnings: uniqueWarnings([
      ...(result.warnings ?? []),
      ...(result.status.reason ? [result.status.reason] : []),
    ]),
  };
}

function uniqueWarnings(warnings: string[]): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const warning of warnings) {
    const normalized = warning.trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    unique.push(normalized);
  }
  return unique;
}

function googleTokenUnavailableReasonFromError(error: unknown): string | null {
  const message = error instanceof Error ? error.message : String(error);
  if (/google_token_refresh_failed|invalid_grant/i.test(message)) {
    return "google_token_refresh_failed";
  }
  return null;
}

export type {
  WorkbenchRetrievalResult,
  WorkbenchRetrievalStatus,
  WorkbenchUserConfig,
} from "./types";
