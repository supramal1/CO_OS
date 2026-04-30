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

export type MondayConnection = {
  userId: string;
  mondayAccountId: string;
  mondayUserId: string;
  mondayTeamIds: string[];
  accessTokenRef: string;
  scope: string[];
  createdAt: string;
  updatedAt: string;
};

export type StoredMondayConnection = MondayConnection & {
  accessToken: string;
};

export type MondayOAuthConnectionInput = {
  accessToken?: string | null;
  mondayAccountId?: string | null;
  mondayUserId?: string | null;
  mondayTeamIds?: string[] | null;
  scope?: string | string[] | null;
};

export type MondayTokenStore = {
  get(userId: string): Promise<StoredMondayConnection | null>;
};

export type MondayConnectionPersistenceOutcome =
  | { status: "stored" }
  | {
      status: "unavailable";
      reason:
        | "missing_user"
        | "missing_access_token"
        | "missing_monday_account"
        | "missing_monday_user"
        | "supabase_unavailable"
        | "storage_unavailable"
        | "encryption_secret_missing";
    }
  | { status: "error"; message: string };

export type MondayConnectionCheckOutcome =
  | { status: "available"; present: boolean }
  | {
      status: "unavailable";
      reason: "missing_user" | "supabase_unavailable" | "storage_unavailable";
    }
  | { status: "error"; message: string };

type PersistMondayConnectionInput = {
  userId: string | null | undefined;
  connection: MondayOAuthConnectionInput | null | undefined;
  supabase?: SupabaseLike | null;
  now?: Date;
};

type TokenRow = {
  user_id: string;
  monday_account_id: string;
  monday_user_id: string;
  monday_team_ids: string[];
  access_token_ciphertext: string;
  scope: string[];
  created_at: string;
  updated_at: string;
};

type StoredTokenRow = {
  user_id?: string | null;
  monday_account_id?: string | null;
  monday_user_id?: string | null;
  monday_team_ids?: string[] | null;
  access_token_ciphertext?: string | null;
  scope?: string[] | null;
  created_at?: string | null;
  updated_at?: string | null;
};

export function createMondayTokenStore(
  supabase?: SupabaseLike | null,
): MondayTokenStore {
  return {
    async get(userId) {
      const normalizedUserId = userId.trim();
      if (!normalizedUserId) return null;

      const sb = supabase ?? (await getDefaultSupabase());
      if (!sb) return null;

      const encryptionSecret = requireEncryptionSecret();
      const { data, error } = await sb
        .from("monday_connections")
        .select(
          [
            "user_id",
            "monday_account_id",
            "monday_user_id",
            "monday_team_ids",
            "access_token_ciphertext",
            "scope",
            "created_at",
            "updated_at",
          ].join(", "),
        )
        .eq("user_id", normalizedUserId)
        .maybeSingle();

      if (error) {
        if (isStorageUnavailableError(error)) return null;
        throw error;
      }
      if (!data || typeof data !== "object") return null;

      const row = data as StoredTokenRow;
      if (
        !row.access_token_ciphertext ||
        !row.monday_account_id ||
        !row.monday_user_id
      ) {
        return null;
      }

      return {
        userId: row.user_id ?? normalizedUserId,
        mondayAccountId: row.monday_account_id,
        mondayUserId: row.monday_user_id,
        mondayTeamIds: Array.isArray(row.monday_team_ids)
          ? row.monday_team_ids
          : [],
        accessToken: decryptToken(row.access_token_ciphertext, encryptionSecret),
        accessTokenRef: toAccessTokenRef(normalizedUserId),
        scope: Array.isArray(row.scope) ? row.scope : [],
        createdAt: row.created_at ?? "",
        updatedAt: row.updated_at ?? "",
      };
    },
  };
}

export async function persistMondayConnection({
  userId,
  connection,
  supabase,
  now = new Date(),
}: PersistMondayConnectionInput): Promise<MondayConnectionPersistenceOutcome> {
  const normalizedUserId = userId?.trim();
  if (!normalizedUserId) return { status: "unavailable", reason: "missing_user" };

  const accessToken = connection?.accessToken?.trim();
  if (!accessToken) {
    return { status: "unavailable", reason: "missing_access_token" };
  }

  const mondayAccountId = connection?.mondayAccountId?.trim();
  if (!mondayAccountId) {
    return { status: "unavailable", reason: "missing_monday_account" };
  }

  const mondayUserId = connection?.mondayUserId?.trim();
  if (!mondayUserId) {
    return { status: "unavailable", reason: "missing_monday_user" };
  }

  const encryptionSecret = process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET;
  if (!encryptionSecret) {
    return { status: "unavailable", reason: "encryption_secret_missing" };
  }

  const sb = supabase ?? (await getDefaultSupabase());
  if (!sb) return { status: "unavailable", reason: "supabase_unavailable" };

  try {
    const timestamp = now.toISOString();
    const { data: existing, error: lookupError } = await sb
      .from("monday_connections")
      .select("user_id, created_at")
      .eq("user_id", normalizedUserId)
      .maybeSingle();

    if (lookupError) return toStorageAwareOutcome(lookupError);

    const existingRow =
      existing && typeof existing === "object"
        ? (existing as StoredTokenRow)
        : null;
    const row: TokenRow = {
      user_id: normalizedUserId,
      monday_account_id: mondayAccountId,
      monday_user_id: mondayUserId,
      monday_team_ids: normalizeStringArray(connection?.mondayTeamIds),
      access_token_ciphertext: encryptToken(accessToken, encryptionSecret),
      scope: normalizeScope(connection?.scope),
      created_at: existingRow?.created_at ?? timestamp,
      updated_at: timestamp,
    };

    const tokenWrite = existing
      ? await sb
          .from("monday_connections")
          .update(row)
          .eq("user_id", normalizedUserId)
      : await sb.from("monday_connections").insert(row);

    if (tokenWrite.error) return toStorageAwareOutcome(tokenWrite.error);
    return { status: "stored" };
  } catch (error) {
    return toErrorOutcome(error);
  }
}

export async function hasStoredMondayConnection(
  userId: string | null | undefined,
  supabase?: SupabaseLike | null,
): Promise<MondayConnectionCheckOutcome> {
  const normalizedUserId = userId?.trim();
  if (!normalizedUserId) return { status: "unavailable", reason: "missing_user" };

  const sb = supabase ?? (await getDefaultSupabase());
  if (!sb) return { status: "unavailable", reason: "supabase_unavailable" };

  try {
    const { data, error } = await sb
      .from("monday_connections")
      .select("user_id")
      .eq("user_id", normalizedUserId)
      .maybeSingle();

    if (error) return toStorageAwareOutcome(error);
    return { status: "available", present: Boolean(data) };
  } catch (error) {
    return toErrorOutcome(error);
  }
}

async function getDefaultSupabase(): Promise<SupabaseLike | null> {
  const { getWorkbenchSupabase } = await import("../workbench/supabase");
  return getWorkbenchSupabase() as unknown as SupabaseLike | null;
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
    throw new Error("Unsupported monday token ciphertext.");
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
    throw new Error("monday_token_encryption_secret_missing");
  }
  return encryptionSecret;
}

function normalizeStringArray(values: string[] | null | undefined): string[] {
  return [
    ...new Set(
      (values ?? [])
        .map((value) => value.trim())
        .filter((value) => value.length > 0),
    ),
  ];
}

function normalizeScope(scope: string | string[] | null | undefined): string[] {
  if (Array.isArray(scope)) return normalizeStringArray(scope);
  return normalizeStringArray((scope ?? "").split(/\s+/));
}

function toAccessTokenRef(userId: string): string {
  return `monday_connections:${userId}`;
}

function toStorageAwareOutcome(
  error: unknown,
): { status: "unavailable"; reason: "storage_unavailable" } | {
  status: "error";
  message: string;
} {
  if (isStorageUnavailableError(error)) {
    return { status: "unavailable", reason: "storage_unavailable" };
  }
  return toErrorOutcome(error);
}

function isStorageUnavailableError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const record = error as { code?: unknown; message?: unknown };
  const code = typeof record.code === "string" ? record.code : "";
  const message = typeof record.message === "string" ? record.message : "";
  return code === "42P01" || /relation .*does not exist|schema cache/i.test(message);
}

function toErrorOutcome(error: unknown): { status: "error"; message: string } {
  return {
    status: "error",
    message: error instanceof Error ? error.message : String(error),
  };
}
