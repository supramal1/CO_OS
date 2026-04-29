import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";

type SupabaseWriteResult = PromiseLike<{ error: unknown | null }>;

type SupabaseLike = {
  from(table: string): {
    select(columns: string): {
      eq(column: string, value: string): {
        maybeSingle(): PromiseLike<{ data: unknown | null; error: unknown | null }>;
      };
    };
    insert(payload: unknown): SupabaseWriteResult;
    update(payload: unknown): {
      eq(column: string, value: string): SupabaseWriteResult;
    };
  };
};

export type WorkbenchNotionOAuthToken = {
  access_token?: string;
  refresh_token?: string;
  bot_id?: string | null;
  workspace_id?: string | null;
  workspace_name?: string | null;
  duplicated_template_id?: string | null;
};

export type WorkbenchNotionStoredToken = {
  accessToken: string | null;
  refreshToken: string | null;
  botId: string | null;
  workspaceId: string | null;
  workspaceName: string | null;
  duplicatedTemplateId: string | null;
};

export type WorkbenchNotionTokenStore = {
  get(principalId: string): Promise<WorkbenchNotionStoredToken | null>;
};

export type WorkbenchNotionTokenPersistenceOutcome =
  | { status: "stored" }
  | {
      status: "unavailable";
      reason:
        | "missing_principal"
        | "missing_access_token"
        | "supabase_unavailable"
        | "encryption_secret_missing";
    }
  | { status: "error"; message: string };

export type WorkbenchNotionStoredTokenCheckOutcome =
  | { status: "available"; present: boolean }
  | { status: "unavailable"; reason: "missing_principal" | "supabase_unavailable" }
  | { status: "error"; message: string };

type PersistWorkbenchNotionOAuthTokenInput = {
  principalId: string | null | undefined;
  token: WorkbenchNotionOAuthToken | null | undefined;
  supabase?: SupabaseLike | null;
  now?: Date;
};

type TokenRow = {
  user_id: string;
  access_token_ciphertext: string;
  refresh_token_ciphertext?: string;
  bot_id?: string | null;
  workspace_id?: string | null;
  workspace_name?: string | null;
  duplicated_template_id?: string | null;
  updated_at: string;
};

type StoredTokenRow = {
  access_token_ciphertext?: string | null;
  refresh_token_ciphertext?: string | null;
  bot_id?: string | null;
  workspace_id?: string | null;
  workspace_name?: string | null;
  duplicated_template_id?: string | null;
};

export function createWorkbenchNotionTokenStore(
  supabase?: SupabaseLike | null,
): WorkbenchNotionTokenStore {
  return {
    async get(principalId) {
      const sb = supabase ?? (await getDefaultSupabase());
      if (!sb) return null;
      const encryptionSecret = requireEncryptionSecret();
      const { data, error } = await sb
        .from("workbench_notion_tokens")
        .select(
          [
            "access_token_ciphertext",
            "refresh_token_ciphertext",
            "bot_id",
            "workspace_id",
            "workspace_name",
            "duplicated_template_id",
          ].join(", "),
        )
        .eq("user_id", principalId)
        .maybeSingle();

      if (error) throw error;
      if (!data || typeof data !== "object") return null;
      const row = data as StoredTokenRow;

      return {
        accessToken: row.access_token_ciphertext
          ? decryptToken(row.access_token_ciphertext, encryptionSecret)
          : null,
        refreshToken: row.refresh_token_ciphertext
          ? decryptToken(row.refresh_token_ciphertext, encryptionSecret)
          : null,
        botId: row.bot_id ?? null,
        workspaceId: row.workspace_id ?? null,
        workspaceName: row.workspace_name ?? null,
        duplicatedTemplateId: row.duplicated_template_id ?? null,
      };
    },
  };
}

export async function persistWorkbenchNotionOAuthToken({
  principalId,
  token,
  supabase,
  now = new Date(),
}: PersistWorkbenchNotionOAuthTokenInput): Promise<WorkbenchNotionTokenPersistenceOutcome> {
  const userId = principalId?.trim();
  if (!userId) return { status: "unavailable", reason: "missing_principal" };

  const accessToken = token?.access_token?.trim();
  if (!accessToken) {
    return { status: "unavailable", reason: "missing_access_token" };
  }

  const encryptionSecret = process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET;
  if (!encryptionSecret) {
    return { status: "unavailable", reason: "encryption_secret_missing" };
  }

  const sb = supabase ?? (await getDefaultSupabase());
  if (!sb) return { status: "unavailable", reason: "supabase_unavailable" };

  try {
    const row: TokenRow = {
      user_id: userId,
      access_token_ciphertext: encryptToken(accessToken, encryptionSecret),
      updated_at: now.toISOString(),
    };
    const refreshToken = token?.refresh_token?.trim();
    if (refreshToken) {
      row.refresh_token_ciphertext = encryptToken(refreshToken, encryptionSecret);
    }
    addOptionalMetadata(row, "bot_id", token?.bot_id);
    addOptionalMetadata(row, "workspace_id", token?.workspace_id);
    addOptionalMetadata(row, "workspace_name", token?.workspace_name);
    addOptionalMetadata(
      row,
      "duplicated_template_id",
      token?.duplicated_template_id,
    );

    const { data: existing, error: lookupError } = await sb
      .from("workbench_notion_tokens")
      .select("user_id")
      .eq("user_id", userId)
      .maybeSingle();

    if (lookupError) return toErrorOutcome(lookupError);

    const tokenWrite = existing
      ? await sb
          .from("workbench_notion_tokens")
          .update(row)
          .eq("user_id", userId)
      : await sb.from("workbench_notion_tokens").insert(row);

    if (tokenWrite.error) return toErrorOutcome(tokenWrite.error);

    return { status: "stored" };
  } catch (error) {
    return toErrorOutcome(error);
  }
}

export async function hasStoredWorkbenchNotionToken(
  principalId: string | null | undefined,
  supabase?: SupabaseLike | null,
): Promise<WorkbenchNotionStoredTokenCheckOutcome> {
  const userId = principalId?.trim();
  if (!userId) return { status: "unavailable", reason: "missing_principal" };

  const sb = supabase ?? (await getDefaultSupabase());
  if (!sb) return { status: "unavailable", reason: "supabase_unavailable" };

  try {
    const { data, error } = await sb
      .from("workbench_notion_tokens")
      .select("user_id")
      .eq("user_id", userId)
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

function addOptionalMetadata(
  row: TokenRow,
  key:
    | "bot_id"
    | "workspace_id"
    | "workspace_name"
    | "duplicated_template_id",
  value: string | null | undefined,
): void {
  const normalized = value?.trim();
  if (normalized) row[key] = normalized;
}

function encryptToken(token: string, secret: string): string {
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
    throw new Error("Unsupported Workbench Notion token ciphertext.");
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
    throw new Error("workbench_notion_token_encryption_secret_missing");
  }
  return encryptionSecret;
}

function toErrorOutcome(error: unknown): { status: "error"; message: string } {
  return {
    status: "error",
    message: error instanceof Error ? error.message : String(error),
  };
}
