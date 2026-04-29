import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import type {
  WorkbenchGoogleAccessTokenUpdate,
  WorkbenchGoogleStoredToken,
  WorkbenchGoogleTokenStore,
} from "./google-token";

type SupabaseWriteResult = PromiseLike<{ error: unknown | null }>;

type SupabaseLike = {
  from(table: string): {
    select(columns: string): {
      eq(column: string, value: string): {
        maybeSingle(): PromiseLike<{ data: unknown | null; error: unknown | null }>;
      };
    };
    insert(payload: unknown): SupabaseWriteResult;
    upsert(payload: unknown, options: { onConflict: string }): SupabaseWriteResult;
    update(payload: unknown): {
      eq(column: string, value: string): SupabaseWriteResult;
    };
  };
};

export type WorkbenchGoogleTokenAccount = {
  provider?: string;
  access_token?: string;
  refresh_token?: string;
  expires_at?: number;
  expires_in?: number;
  scope?: string;
  token_type?: string;
};

export type WorkbenchGoogleTokenPersistenceOutcome =
  | { status: "stored" }
  | {
      status: "unavailable";
      reason:
        | "missing_principal"
        | "missing_google_account"
        | "missing_access_token"
        | "supabase_unavailable"
        | "encryption_secret_missing";
    }
  | { status: "error"; message: string };

export type WorkbenchGoogleStoredTokenCheckOutcome =
  | { status: "available"; present: boolean }
  | { status: "unavailable"; reason: "missing_principal" | "supabase_unavailable" }
  | { status: "error"; message: string };

type PersistWorkbenchGoogleTokensInput = {
  principalId: string | null | undefined;
  account: WorkbenchGoogleTokenAccount | null | undefined;
  supabase?: SupabaseLike | null;
  now?: Date;
};

type TokenRow = {
  user_id: string;
  access_token_ciphertext: string;
  refresh_token_ciphertext?: string;
  expires_at: string | null;
  scope: string[];
  token_type: string | null;
  updated_at: string;
};

type StoredTokenRow = {
  access_token_ciphertext?: string | null;
  refresh_token_ciphertext?: string | null;
  expires_at?: string | null;
};

export function createWorkbenchGoogleTokenStore(
  supabase?: SupabaseLike | null,
): WorkbenchGoogleTokenStore {
  return {
    async get(principalId) {
      const sb = supabase ?? (await getDefaultSupabase());
      if (!sb) return null;
      const encryptionSecret = requireEncryptionSecret();
      const { data, error } = await sb
        .from("workbench_google_tokens")
        .select("access_token_ciphertext, refresh_token_ciphertext, expires_at")
        .eq("user_id", principalId)
        .maybeSingle();

      if (error) throw error;
      if (!data || typeof data !== "object") return null;
      const row = data as StoredTokenRow;
      const accessToken = row.access_token_ciphertext
        ? decryptToken(row.access_token_ciphertext, encryptionSecret)
        : null;
      const refreshToken = row.refresh_token_ciphertext
        ? decryptToken(row.refresh_token_ciphertext, encryptionSecret)
        : null;

      return {
        accessToken,
        refreshToken,
        expiresAtMs: row.expires_at ? Date.parse(row.expires_at) : null,
      } satisfies WorkbenchGoogleStoredToken;
    },
    async updateAccessToken(update) {
      const sb = supabase ?? (await getDefaultSupabase());
      if (!sb) throw new Error("workbench_google_token_store_unavailable");
      const encryptionSecret = requireEncryptionSecret();
      await updateStoredAccessToken(sb, update, encryptionSecret);
    },
  };
}

export async function persistWorkbenchGoogleTokens({
  principalId,
  account,
  supabase,
  now = new Date(),
}: PersistWorkbenchGoogleTokensInput): Promise<WorkbenchGoogleTokenPersistenceOutcome> {
  if (!principalId) return { status: "unavailable", reason: "missing_principal" };
  if (!account || account.provider !== "google") {
    return { status: "unavailable", reason: "missing_google_account" };
  }
  if (!account.access_token) {
    return { status: "unavailable", reason: "missing_access_token" };
  }

  const encryptionSecret = process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET;
  if (!encryptionSecret) {
    return { status: "unavailable", reason: "encryption_secret_missing" };
  }

  const sb = supabase ?? (await getDefaultSupabase());
  if (!sb) return { status: "unavailable", reason: "supabase_unavailable" };

  try {
    const scopes = parseScope(account.scope);
    const row: TokenRow = {
      user_id: principalId,
      access_token_ciphertext: encryptToken(account.access_token, encryptionSecret),
      expires_at: resolveExpiresAt(account, now),
      scope: scopes,
      token_type: account.token_type ?? null,
      updated_at: now.toISOString(),
    };

    if (account.refresh_token) {
      row.refresh_token_ciphertext = encryptToken(
        account.refresh_token,
        encryptionSecret,
      );
    }

    const { data: existing, error: lookupError } = await sb
      .from("workbench_google_tokens")
      .select("user_id")
      .eq("user_id", principalId)
      .maybeSingle();

    if (lookupError) return toErrorOutcome(lookupError);

    const tokenWrite = existing
      ? await sb
          .from("workbench_google_tokens")
          .update(row)
          .eq("user_id", principalId)
      : await sb.from("workbench_google_tokens").insert(row);

    if (tokenWrite.error) return toErrorOutcome(tokenWrite.error);

    const configWrite = await sb.from("user_workbench_config").upsert(
      {
        user_id: principalId,
        google_oauth_grant_status: "granted",
        google_oauth_scopes: scopes,
        updated_at: now.toISOString(),
      },
      { onConflict: "user_id" },
    );

    if (configWrite.error) return toErrorOutcome(configWrite.error);

    return { status: "stored" };
  } catch (error) {
    return toErrorOutcome(error);
  }
}

async function updateStoredAccessToken(
  sb: SupabaseLike,
  update: WorkbenchGoogleAccessTokenUpdate,
  encryptionSecret: string,
): Promise<void> {
  const { error } = await sb
    .from("workbench_google_tokens")
    .update({
      access_token_ciphertext: encryptToken(update.accessToken, encryptionSecret),
      expires_at: new Date(update.expiresAtMs).toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", update.principalId);

  if (error) throw error;
}

export async function hasStoredWorkbenchGoogleToken(
  principalId: string | null | undefined,
  supabase?: SupabaseLike | null,
): Promise<WorkbenchGoogleStoredTokenCheckOutcome> {
  if (!principalId) return { status: "unavailable", reason: "missing_principal" };

  const sb = supabase ?? (await getDefaultSupabase());
  if (!sb) return { status: "unavailable", reason: "supabase_unavailable" };

  try {
    const { data, error } = await sb
      .from("workbench_google_tokens")
      .select("user_id")
      .eq("user_id", principalId)
      .maybeSingle();

    if (error) return toErrorOutcome(error);
    return { status: "available", present: Boolean(data) };
  } catch (error) {
    return toErrorOutcome(error);
  }
}

async function getDefaultSupabase(): Promise<SupabaseLike | null> {
  const { getWorkbenchSupabase } = await import("./supabase");
  return getWorkbenchSupabase() as unknown as SupabaseLike | null;
}

function encryptToken(token: string, secret: string): string {
  // Server-only token encryption depends on AUTH_SECRET/NEXTAUTH_SECRET.
  // Rotating that secret invalidates stored Google token ciphertext.
  const key = createHash("sha256").update(secret).digest();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(token, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  return [
    "v1",
    iv.toString("base64url"),
    authTag.toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(".");
}

function decryptToken(value: string, secret: string): string {
  const [version, encodedIv, encodedAuthTag, encodedCiphertext] = value.split(".");
  if (
    version !== "v1" ||
    !encodedIv ||
    !encodedAuthTag ||
    !encodedCiphertext
  ) {
    throw new Error("Unsupported Workbench Google token ciphertext.");
  }
  const key = createHash("sha256").update(secret).digest();
  const decipher = createDecipheriv(
    "aes-256-gcm",
    key,
    Buffer.from(encodedIv, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(encodedAuthTag, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(encodedCiphertext, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

function requireEncryptionSecret(): string {
  const encryptionSecret = process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET;
  if (!encryptionSecret) {
    throw new Error("workbench_google_token_encryption_secret_missing");
  }
  return encryptionSecret;
}

function parseScope(scope: string | undefined): string[] {
  return [...new Set((scope ?? "").split(/\s+/).filter(Boolean))];
}

function resolveExpiresAt(
  account: WorkbenchGoogleTokenAccount,
  now: Date,
): string | null {
  if (typeof account.expires_at === "number") {
    return new Date(account.expires_at * 1000).toISOString();
  }
  if (typeof account.expires_in === "number") {
    return new Date(now.getTime() + account.expires_in * 1000).toISOString();
  }
  return null;
}

function toErrorOutcome(error: unknown): { status: "error"; message: string } {
  return {
    status: "error",
    message: error instanceof Error ? error.message : String(error),
  };
}
