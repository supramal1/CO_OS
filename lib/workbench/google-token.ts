export type WorkbenchGoogleStoredToken = {
  accessToken: string | null;
  refreshToken: string | null;
  expiresAtMs: number | null;
};

export type WorkbenchGoogleAccessTokenUpdate = {
  principalId: string;
  accessToken: string;
  expiresAtMs: number;
};

export type WorkbenchGoogleTokenStore = {
  get(principalId: string): Promise<WorkbenchGoogleStoredToken | null>;
  updateAccessToken(update: WorkbenchGoogleAccessTokenUpdate): Promise<void>;
};

export type WorkbenchGoogleAccessTokenResult =
  | {
      status: "available";
      accessToken: string;
      refreshed: boolean;
    }
  | {
      status: "unavailable";
      reason:
        | "principal_missing"
        | "google_token_store_missing"
        | "google_access_token_missing"
        | "google_refresh_token_missing";
    }
  | {
      status: "error";
      reason:
        | "google_token_lookup_failed"
        | "google_token_refresh_config_missing"
        | "google_token_refresh_failed"
        | "google_token_persist_failed";
      message: string;
    };

export type GetWorkbenchGoogleAccessTokenInput = {
  principalId: string | null | undefined;
  now?: Date;
  fetch?: typeof fetch;
  tokenStore?: WorkbenchGoogleTokenStore;
  clientId?: string;
  clientSecret?: string;
};

type GoogleRefreshTokenResponse = {
  access_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
};

const GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";

export async function getWorkbenchGoogleAccessToken(
  input: GetWorkbenchGoogleAccessTokenInput,
): Promise<WorkbenchGoogleAccessTokenResult> {
  const principalId = input.principalId?.trim();
  if (!principalId) {
    return { status: "unavailable", reason: "principal_missing" };
  }

  if (!input.tokenStore) {
    return { status: "unavailable", reason: "google_token_store_missing" };
  }

  let stored: WorkbenchGoogleStoredToken | null;
  try {
    stored = await input.tokenStore.get(principalId);
  } catch (error) {
    return {
      status: "error",
      reason: "google_token_lookup_failed",
      message: errorMessage(error),
    };
  }

  if (!stored) {
    return { status: "unavailable", reason: "google_access_token_missing" };
  }

  const accessToken = stored.accessToken?.trim();
  if (!accessToken) {
    return { status: "unavailable", reason: "google_access_token_missing" };
  }

  const nowMs = (input.now ?? new Date()).getTime();
  if (stored.expiresAtMs !== null && stored.expiresAtMs > nowMs) {
    return {
      status: "available",
      accessToken,
      refreshed: false,
    };
  }

  const refreshToken = stored.refreshToken?.trim();
  if (!refreshToken) {
    return { status: "unavailable", reason: "google_refresh_token_missing" };
  }

  const clientId = input.clientId ?? process.env.GOOGLE_CLIENT_ID;
  const clientSecret = input.clientSecret ?? process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return {
      status: "error",
      reason: "google_token_refresh_config_missing",
      message: "Google OAuth client credentials are not configured.",
    };
  }

  const refreshResult = await refreshGoogleAccessToken({
    fetchImpl: input.fetch ?? fetch,
    clientId,
    clientSecret,
    refreshToken,
    nowMs,
  });
  if (refreshResult.status === "error") return refreshResult;

  try {
    await input.tokenStore.updateAccessToken({
      principalId,
      accessToken: refreshResult.accessToken,
      expiresAtMs: refreshResult.expiresAtMs,
    });
  } catch (error) {
    return {
      status: "error",
      reason: "google_token_persist_failed",
      message: errorMessage(error),
    };
  }

  return {
    status: "available",
    accessToken: refreshResult.accessToken,
    refreshed: true,
  };
}

async function refreshGoogleAccessToken(input: {
  fetchImpl: typeof fetch;
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  nowMs: number;
}): Promise<
  | { status: "available"; accessToken: string; expiresAtMs: number }
  | Extract<WorkbenchGoogleAccessTokenResult, { status: "error" }>
> {
  try {
    const body = new URLSearchParams();
    body.set("client_id", input.clientId);
    body.set("client_secret", input.clientSecret);
    body.set("refresh_token", input.refreshToken);
    body.set("grant_type", "refresh_token");

    const response = await input.fetchImpl(GOOGLE_TOKEN_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body,
    });
    const data = (await response.json()) as GoogleRefreshTokenResponse;

    if (!response.ok || !data.access_token) {
      return {
        status: "error",
        reason: "google_token_refresh_failed",
        message:
          data.error_description ??
          data.error ??
          `Google token refresh failed: ${response.status}`,
      };
    }

    return {
      status: "available",
      accessToken: data.access_token,
      expiresAtMs: input.nowMs + Math.max(data.expires_in ?? 0, 0) * 1000,
    };
  } catch (error) {
    return {
      status: "error",
      reason: "google_token_refresh_failed",
      message: errorMessage(error),
    };
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
