import {
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

export const DEFAULT_MONDAY_OAUTH_AUTH_URL =
  "https://auth.monday.com/oauth2/authorize";

const STATE_VERSION = 1;
const STATE_MAX_AGE_MS = 10 * 60 * 1000;

export type MondayOAuthEnv = {
  MONDAY_CLIENT_ID?: string | null;
  MONDAY_CLIENT_SECRET?: string | null;
  MONDAY_OAUTH_AUTH_URL?: string | null;
  AUTH_SECRET?: string | null;
  NEXTAUTH_SECRET?: string | null;
};

export type MondayOAuthUnavailableReason =
  | "monday_client_id_missing"
  | "monday_client_secret_missing"
  | "monday_oauth_origin_missing"
  | "monday_oauth_state_secret_missing"
  | "monday_oauth_auth_url_invalid";

export type MondayOAuthConfig =
  | {
      status: "ready";
      clientId: string;
      clientSecret: string;
      redirectUri: string;
      authUrl: string;
    }
  | {
      status: "unavailable";
      reason: Extract<
        MondayOAuthUnavailableReason,
        | "monday_client_id_missing"
        | "monday_client_secret_missing"
        | "monday_oauth_origin_missing"
      >;
    };

export type MondayAuthorizationUrlResult =
  | { status: "ready"; url: URL }
  | { status: "unavailable"; reason: MondayOAuthUnavailableReason };

export type MondayOAuthStateVerification =
  | { status: "valid"; issuedAt: number }
  | {
      status: "invalid";
      reason:
        | "monday_oauth_state_missing"
        | "monday_oauth_state_malformed"
        | "monday_oauth_state_signature_invalid"
        | "monday_oauth_state_expired"
        | "monday_oauth_state_principal_mismatch"
        | "monday_oauth_state_secret_missing";
    };

type MondayOAuthStatePayload = {
  v: typeof STATE_VERSION;
  iat: number;
  nonce: string;
  principal_hash: string;
};

export function getMondayOAuthConfig(input: {
  origin: string | null | undefined;
  env?: MondayOAuthEnv;
}): MondayOAuthConfig {
  const env = input.env ?? getProcessEnv();
  const clientId = env.MONDAY_CLIENT_ID?.trim();
  if (!clientId) {
    return { status: "unavailable", reason: "monday_client_id_missing" };
  }

  const clientSecret = env.MONDAY_CLIENT_SECRET?.trim();
  if (!clientSecret) {
    return { status: "unavailable", reason: "monday_client_secret_missing" };
  }

  const origin = input.origin?.trim();
  if (!origin) {
    return { status: "unavailable", reason: "monday_oauth_origin_missing" };
  }

  return {
    status: "ready",
    clientId,
    clientSecret,
    redirectUri: new URL("/api/monday/callback", origin).toString(),
    authUrl: env.MONDAY_OAUTH_AUTH_URL?.trim() || DEFAULT_MONDAY_OAUTH_AUTH_URL,
  };
}

export function createMondayAuthorizationUrl(input: {
  origin: string;
  principalId: string;
  env?: MondayOAuthEnv;
  now?: Date;
}): MondayAuthorizationUrlResult {
  const env = input.env ?? getProcessEnv();
  const config = getMondayOAuthConfig({ origin: input.origin, env });
  if (config.status === "unavailable") return config;

  if (!getStateSecret(env)) {
    return {
      status: "unavailable",
      reason: "monday_oauth_state_secret_missing",
    };
  }

  let url: URL;
  try {
    url = new URL(config.authUrl);
  } catch {
    return { status: "unavailable", reason: "monday_oauth_auth_url_invalid" };
  }

  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("redirect_uri", config.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set(
    "state",
    signMondayOAuthState({
      principalId: input.principalId,
      env,
      now: input.now,
    }),
  );

  return { status: "ready", url };
}

export function signMondayOAuthState(input: {
  principalId: string;
  env?: MondayOAuthEnv;
  now?: Date;
  nonce?: string;
  secret?: string | null;
}): string {
  const secret = requireStateSecret(input.secret, input.env);
  const payload: MondayOAuthStatePayload = {
    v: STATE_VERSION,
    iat: (input.now ?? new Date()).getTime(),
    nonce: input.nonce ?? randomBytes(16).toString("base64url"),
    principal_hash: bindStateValue("principal", input.principalId, secret),
  };
  const encodedPayload = Buffer.from(JSON.stringify(payload), "utf8").toString(
    "base64url",
  );
  const signature = signStatePayload(encodedPayload, secret);
  return `${encodedPayload}.${signature}`;
}

export function verifyMondayOAuthState(input: {
  state: string | null | undefined;
  principalId: string;
  env?: MondayOAuthEnv;
  now?: Date;
  maxAgeMs?: number;
  secret?: string | null;
}): MondayOAuthStateVerification {
  const state = input.state?.trim();
  if (!state) {
    return { status: "invalid", reason: "monday_oauth_state_missing" };
  }

  const secret = getStateSecret(input.env, input.secret);
  if (!secret) {
    return { status: "invalid", reason: "monday_oauth_state_secret_missing" };
  }

  const [encodedPayload, signature, extra] = state.split(".");
  if (!encodedPayload || !signature || extra !== undefined) {
    return { status: "invalid", reason: "monday_oauth_state_malformed" };
  }

  if (!safeEqual(signature, signStatePayload(encodedPayload, secret))) {
    return {
      status: "invalid",
      reason: "monday_oauth_state_signature_invalid",
    };
  }

  const payload = parseStatePayload(encodedPayload);
  if (!payload) {
    return { status: "invalid", reason: "monday_oauth_state_malformed" };
  }

  const now = input.now ?? new Date();
  const maxAgeMs = input.maxAgeMs ?? STATE_MAX_AGE_MS;
  if (now.getTime() - payload.iat > maxAgeMs) {
    return { status: "invalid", reason: "monday_oauth_state_expired" };
  }

  if (
    payload.principal_hash !==
    bindStateValue("principal", input.principalId, secret)
  ) {
    return {
      status: "invalid",
      reason: "monday_oauth_state_principal_mismatch",
    };
  }

  return { status: "valid", issuedAt: payload.iat };
}

function getProcessEnv(): MondayOAuthEnv {
  return {
    MONDAY_CLIENT_ID: process.env.MONDAY_CLIENT_ID,
    MONDAY_CLIENT_SECRET: process.env.MONDAY_CLIENT_SECRET,
    MONDAY_OAUTH_AUTH_URL: process.env.MONDAY_OAUTH_AUTH_URL,
    AUTH_SECRET: process.env.AUTH_SECRET,
    NEXTAUTH_SECRET: process.env.NEXTAUTH_SECRET,
  };
}

function getStateSecret(
  env: MondayOAuthEnv = getProcessEnv(),
  override?: string | null,
): string | null {
  return (
    override?.trim() ||
    env.AUTH_SECRET?.trim() ||
    env.NEXTAUTH_SECRET?.trim() ||
    null
  );
}

function requireStateSecret(
  override?: string | null,
  env?: MondayOAuthEnv,
): string {
  const secret = getStateSecret(env, override);
  if (!secret) throw new Error("monday_oauth_state_secret_missing");
  return secret;
}

function bindStateValue(label: string, value: string, secret: string): string {
  return createHmac("sha256", secret)
    .update(`${label}:${value}`)
    .digest("base64url");
}

function signStatePayload(encodedPayload: string, secret: string): string {
  return createHmac("sha256", secret).update(encodedPayload).digest("base64url");
}

function parseStatePayload(
  encodedPayload: string,
): MondayOAuthStatePayload | null {
  try {
    const parsed = JSON.parse(
      Buffer.from(encodedPayload, "base64url").toString("utf8"),
    ) as Partial<MondayOAuthStatePayload>;
    if (
      parsed.v !== STATE_VERSION ||
      typeof parsed.iat !== "number" ||
      typeof parsed.nonce !== "string" ||
      typeof parsed.principal_hash !== "string"
    ) {
      return null;
    }
    return parsed as MondayOAuthStatePayload;
  } catch {
    return null;
  }
}

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return (
    leftBuffer.length === rightBuffer.length &&
    timingSafeEqual(leftBuffer, rightBuffer)
  );
}
