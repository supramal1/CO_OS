import {
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

export const DEFAULT_NOTION_OAUTH_AUTH_URL =
  "https://api.notion.com/v1/oauth/authorize";
export const NOTION_OAUTH_TOKEN_URL = "https://api.notion.com/v1/oauth/token";

const STATE_VERSION = 1;
const STATE_MAX_AGE_MS = 10 * 60 * 1000;

export type WorkbenchNotionOAuthEnv = {
  NOTION_OAUTH_CLIENT_ID?: string | null;
  NOTION_OAUTH_CLIENT_SECRET?: string | null;
  NOTION_OAUTH_REDIRECT_URI?: string | null;
  NOTION_OAUTH_AUTH_URL?: string | null;
  AUTH_SECRET?: string | null;
  NEXTAUTH_SECRET?: string | null;
};

export type WorkbenchNotionOAuthConfig =
  | {
      status: "ready";
      clientId: string;
      clientSecret: string;
      redirectUri: string;
      authUrl: string;
      tokenUrl: typeof NOTION_OAUTH_TOKEN_URL;
    }
  | {
      status: "unavailable";
      reason:
        | "notion_oauth_client_id_missing"
        | "notion_oauth_client_secret_missing"
        | "notion_oauth_redirect_uri_missing";
    };

export type WorkbenchNotionOAuthUnavailableReason =
  | Extract<WorkbenchNotionOAuthConfig, { status: "unavailable" }>["reason"]
  | "notion_oauth_state_secret_missing"
  | "notion_oauth_auth_url_invalid";

export type WorkbenchNotionAuthorizationUrlResult =
  | { status: "ready"; url: URL }
  | { status: "unavailable"; reason: WorkbenchNotionOAuthUnavailableReason };

export type WorkbenchNotionOAuthStateVerification =
  | { status: "valid"; issuedAt: number }
  | {
      status: "invalid";
      reason:
        | "notion_oauth_state_missing"
        | "notion_oauth_state_malformed"
        | "notion_oauth_state_signature_invalid"
        | "notion_oauth_state_expired"
        | "notion_oauth_state_principal_mismatch"
        | "notion_oauth_state_session_mismatch"
        | "notion_oauth_state_secret_missing";
    };

export type WorkbenchNotionOAuthTokenResponse = {
  access_token: string;
  refresh_token?: string;
  bot_id?: string;
  workspace_id?: string;
  workspace_name?: string;
  duplicated_template_id?: string;
};

export type WorkbenchNotionOAuthExchangeResult =
  | {
      status: "exchanged";
      token: WorkbenchNotionOAuthTokenResponse;
    }
  | {
      status: "unavailable";
      reason:
        | Extract<WorkbenchNotionOAuthConfig, { status: "unavailable" }>["reason"]
        | "notion_oauth_code_missing";
    }
  | {
      status: "error";
      reason: "notion_token_exchange_failed" | "notion_token_response_invalid";
      statusCode?: number;
    };

type WorkbenchNotionOAuthStatePayload = {
  v: typeof STATE_VERSION;
  iat: number;
  nonce: string;
  principal_hash: string;
  session_hash: string;
};

export function getWorkbenchNotionOAuthConfig(
  env: WorkbenchNotionOAuthEnv = getProcessEnv(),
): WorkbenchNotionOAuthConfig {
  const clientId = env.NOTION_OAUTH_CLIENT_ID?.trim();
  if (!clientId) {
    return { status: "unavailable", reason: "notion_oauth_client_id_missing" };
  }

  const clientSecret = env.NOTION_OAUTH_CLIENT_SECRET?.trim();
  if (!clientSecret) {
    return {
      status: "unavailable",
      reason: "notion_oauth_client_secret_missing",
    };
  }

  const redirectUri = env.NOTION_OAUTH_REDIRECT_URI?.trim();
  if (!redirectUri) {
    return {
      status: "unavailable",
      reason: "notion_oauth_redirect_uri_missing",
    };
  }

  return {
    status: "ready",
    clientId,
    clientSecret,
    redirectUri,
    authUrl: env.NOTION_OAUTH_AUTH_URL?.trim() || DEFAULT_NOTION_OAUTH_AUTH_URL,
    tokenUrl: NOTION_OAUTH_TOKEN_URL,
  };
}

export function createWorkbenchNotionAuthorizationUrl(input: {
  principalId: string;
  sessionBinding?: string | null;
  env?: WorkbenchNotionOAuthEnv;
  now?: Date;
}): WorkbenchNotionAuthorizationUrlResult {
  const env = input.env ?? getProcessEnv();
  const config = getWorkbenchNotionOAuthConfig(env);
  if (config.status === "unavailable") return config;

  if (!getStateSecret(env)) {
    return {
      status: "unavailable",
      reason: "notion_oauth_state_secret_missing",
    };
  }

  let url: URL;
  try {
    url = new URL(config.authUrl);
  } catch {
    return {
      status: "unavailable",
      reason: "notion_oauth_auth_url_invalid",
    };
  }

  url.searchParams.set("owner", "user");
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("redirect_uri", config.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set(
    "state",
    signWorkbenchNotionOAuthState({
      principalId: input.principalId,
      sessionBinding: input.sessionBinding,
      env,
      now: input.now,
    }),
  );

  return { status: "ready", url };
}

export function signWorkbenchNotionOAuthState(input: {
  principalId: string;
  sessionBinding?: string | null;
  env?: WorkbenchNotionOAuthEnv;
  now?: Date;
  nonce?: string;
  secret?: string | null;
}): string {
  const secret = requireStateSecret(input.secret, input.env);
  const sessionBinding = input.sessionBinding?.trim() || input.principalId;
  const payload: WorkbenchNotionOAuthStatePayload = {
    v: STATE_VERSION,
    iat: (input.now ?? new Date()).getTime(),
    nonce: input.nonce ?? randomBytes(16).toString("base64url"),
    principal_hash: bindStateValue("principal", input.principalId, secret),
    session_hash: bindStateValue("session", sessionBinding, secret),
  };
  const encodedPayload = Buffer.from(JSON.stringify(payload), "utf8").toString(
    "base64url",
  );
  const signature = signStatePayload(encodedPayload, secret);
  return `${encodedPayload}.${signature}`;
}

export function verifyWorkbenchNotionOAuthState(input: {
  state: string | null | undefined;
  principalId: string;
  sessionBinding?: string | null;
  env?: WorkbenchNotionOAuthEnv;
  now?: Date;
  maxAgeMs?: number;
  secret?: string | null;
}): WorkbenchNotionOAuthStateVerification {
  const state = input.state?.trim();
  if (!state) {
    return { status: "invalid", reason: "notion_oauth_state_missing" };
  }

  const secret = getStateSecret(input.env, input.secret);
  if (!secret) {
    return { status: "invalid", reason: "notion_oauth_state_secret_missing" };
  }

  const [encodedPayload, signature, extra] = state.split(".");
  if (!encodedPayload || !signature || extra !== undefined) {
    return { status: "invalid", reason: "notion_oauth_state_malformed" };
  }

  if (!safeEqual(signature, signStatePayload(encodedPayload, secret))) {
    return {
      status: "invalid",
      reason: "notion_oauth_state_signature_invalid",
    };
  }

  const payload = parseStatePayload(encodedPayload);
  if (!payload) {
    return { status: "invalid", reason: "notion_oauth_state_malformed" };
  }

  const now = input.now ?? new Date();
  const maxAgeMs = input.maxAgeMs ?? STATE_MAX_AGE_MS;
  if (now.getTime() - payload.iat > maxAgeMs) {
    return { status: "invalid", reason: "notion_oauth_state_expired" };
  }

  if (
    payload.principal_hash !==
    bindStateValue("principal", input.principalId, secret)
  ) {
    return {
      status: "invalid",
      reason: "notion_oauth_state_principal_mismatch",
    };
  }

  const sessionBinding = input.sessionBinding?.trim() || input.principalId;
  if (
    payload.session_hash !== bindStateValue("session", sessionBinding, secret)
  ) {
    return {
      status: "invalid",
      reason: "notion_oauth_state_session_mismatch",
    };
  }

  return { status: "valid", issuedAt: payload.iat };
}

export async function exchangeWorkbenchNotionOAuthCode(input: {
  code: string | null | undefined;
  env?: WorkbenchNotionOAuthEnv;
  fetch?: typeof fetch;
}): Promise<WorkbenchNotionOAuthExchangeResult> {
  const code = input.code?.trim();
  if (!code) {
    return { status: "unavailable", reason: "notion_oauth_code_missing" };
  }

  const config = getWorkbenchNotionOAuthConfig(input.env);
  if (config.status === "unavailable") return config;

  const fetcher = input.fetch ?? fetch;
  try {
    const response = await fetcher(config.tokenUrl, {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(
          `${config.clientId}:${config.clientSecret}`,
        ).toString("base64")}`,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        grant_type: "authorization_code",
        code,
        redirect_uri: config.redirectUri,
      }),
    });

    if (!response.ok) {
      return {
        status: "error",
        reason: "notion_token_exchange_failed",
        statusCode: response.status,
      };
    }

    const token = normalizeTokenResponse(await response.json());
    if (!token) {
      return { status: "error", reason: "notion_token_response_invalid" };
    }

    return { status: "exchanged", token };
  } catch {
    return { status: "error", reason: "notion_token_exchange_failed" };
  }
}

function normalizeTokenResponse(
  value: unknown,
): WorkbenchNotionOAuthTokenResponse | null {
  if (!value || typeof value !== "object") return null;
  const body = value as Record<string, unknown>;
  const accessToken = stringValue(body.access_token);
  if (!accessToken) return null;

  return removeUndefined({
    access_token: accessToken,
    refresh_token: stringValue(body.refresh_token),
    bot_id: stringValue(body.bot_id),
    workspace_id: stringValue(body.workspace_id),
    workspace_name: stringValue(body.workspace_name),
    duplicated_template_id: stringValue(body.duplicated_template_id),
  });
}

function parseStatePayload(
  encodedPayload: string,
): WorkbenchNotionOAuthStatePayload | null {
  try {
    const parsed = JSON.parse(
      Buffer.from(encodedPayload, "base64url").toString("utf8"),
    ) as Partial<WorkbenchNotionOAuthStatePayload>;
    if (
      parsed.v !== STATE_VERSION ||
      typeof parsed.iat !== "number" ||
      typeof parsed.nonce !== "string" ||
      typeof parsed.principal_hash !== "string" ||
      typeof parsed.session_hash !== "string"
    ) {
      return null;
    }
    return parsed as WorkbenchNotionOAuthStatePayload;
  } catch {
    return null;
  }
}

function signStatePayload(encodedPayload: string, secret: string): string {
  return createHmac("sha256", secret)
    .update(`workbench-notion-oauth-state:${encodedPayload}`)
    .digest("base64url");
}

function bindStateValue(
  type: "principal" | "session",
  value: string,
  secret: string,
): string {
  return createHmac("sha256", secret)
    .update(`workbench-notion-oauth-${type}:${value}`)
    .digest("base64url");
}

function safeEqual(a: string, b: string): boolean {
  try {
    const left = Buffer.from(a, "base64url");
    const right = Buffer.from(b, "base64url");
    return left.length === right.length && timingSafeEqual(left, right);
  } catch {
    return false;
  }
}

function requireStateSecret(
  explicitSecret?: string | null,
  env?: WorkbenchNotionOAuthEnv,
): string {
  const secret = getStateSecret(env, explicitSecret);
  if (!secret) {
    throw new Error("workbench_notion_oauth_state_secret_missing");
  }
  return secret;
}

function getStateSecret(
  env: WorkbenchNotionOAuthEnv = getProcessEnv(),
  explicitSecret?: string | null,
): string | null {
  return (
    explicitSecret?.trim() ||
    env.AUTH_SECRET?.trim() ||
    env.NEXTAUTH_SECRET?.trim() ||
    null
  );
}

function getProcessEnv(): WorkbenchNotionOAuthEnv {
  if (typeof process === "undefined") return {};
  return {
    NOTION_OAUTH_CLIENT_ID: process.env.NOTION_OAUTH_CLIENT_ID,
    NOTION_OAUTH_CLIENT_SECRET: process.env.NOTION_OAUTH_CLIENT_SECRET,
    NOTION_OAUTH_REDIRECT_URI: process.env.NOTION_OAUTH_REDIRECT_URI,
    NOTION_OAUTH_AUTH_URL: process.env.NOTION_OAUTH_AUTH_URL,
    AUTH_SECRET: process.env.AUTH_SECRET,
    NEXTAUTH_SECRET: process.env.NEXTAUTH_SECRET,
  };
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function removeUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined),
  ) as T;
}
