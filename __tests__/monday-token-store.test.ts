import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createMondayTokenStore,
  hasStoredMondayConnection,
  persistMondayConnection,
  type MondayOAuthConnectionInput,
} from "@/lib/monday/token-store";

function createSupabaseDouble(existingToken: Record<string, unknown> | null = null) {
  const calls: Array<{
    table: string;
    operation: string;
    payload?: unknown;
    match?: Record<string, string>;
  }> = [];

  return {
    calls,
    from(table: string) {
      return {
        select() {
          return {
            eq(column: string, value: string) {
              calls.push({
                table,
                operation: "select.eq",
                match: { [column]: value },
              });
              return {
                async maybeSingle() {
                  return { data: existingToken, error: null };
                },
              };
            },
          };
        },
        insert(payload: unknown) {
          calls.push({ table, operation: "insert", payload });
          return Promise.resolve({ error: null });
        },
        update(payload: unknown) {
          return {
            eq(column: string, value: string) {
              calls.push({
                table,
                operation: "update.eq",
                payload,
                match: { [column]: value },
              });
              return Promise.resolve({ error: null });
            },
          };
        },
      };
    },
  };
}

function createMissingTableSupabaseDouble() {
  return {
    from() {
      return {
        select() {
          return {
            eq() {
              return {
                async maybeSingle() {
                  return {
                    data: null,
                    error: { code: "42P01", message: "relation does not exist" },
                  };
                },
              };
            },
          };
        },
        insert() {
          return Promise.resolve({
            error: { code: "42P01", message: "relation does not exist" },
          });
        },
        update() {
          return {
            eq() {
              return Promise.resolve({
                error: { code: "42P01", message: "relation does not exist" },
              });
            },
          };
        },
      };
    },
  };
}

describe("monday token store", () => {
  const originalAuthSecret = process.env.AUTH_SECRET;
  const originalNextAuthSecret = process.env.NEXTAUTH_SECRET;

  beforeEach(() => {
    process.env.AUTH_SECRET = "test-auth-secret-for-monday-tokens";
    delete process.env.NEXTAUTH_SECRET;
  });

  afterEach(() => {
    process.env.AUTH_SECRET = originalAuthSecret;
    process.env.NEXTAUTH_SECRET = originalNextAuthSecret;
  });

  it("stores monday connection tokens encrypted with identity metadata", async () => {
    const supabase = createSupabaseDouble();
    const connection: MondayOAuthConnectionInput = {
      accessToken: "monday-access-token",
      mondayAccountId: "account_123",
      mondayUserId: "user_456",
      mondayTeamIds: ["team_a", "team_b", "team_a"],
      scope: "boards:read users:read",
    };

    const outcome = await persistMondayConnection({
      userId: "principal_123",
      connection,
      supabase,
      now: new Date("2026-04-30T15:08:00.000Z"),
    });

    expect(outcome).toEqual({ status: "stored" });
    const tokenWrite = supabase.calls.find(
      (call) => call.table === "monday_connections" && call.operation === "insert",
    );
    expect(tokenWrite?.payload).toMatchObject({
      user_id: "principal_123",
      monday_account_id: "account_123",
      monday_user_id: "user_456",
      monday_team_ids: ["team_a", "team_b"],
      scope: ["boards:read", "users:read"],
      created_at: "2026-04-30T15:08:00.000Z",
      updated_at: "2026-04-30T15:08:00.000Z",
    });
    expect(JSON.stringify(tokenWrite?.payload)).not.toContain("monday-access-token");
  });

  it("implements encrypted round-trip reads without exposing ciphertext as the token ref", async () => {
    const supabase = createSupabaseDouble();
    await persistMondayConnection({
      userId: "principal_123",
      connection: {
        accessToken: "monday-access-token",
        mondayAccountId: "account_123",
        mondayUserId: "user_456",
      },
      supabase,
      now: new Date("2026-04-30T15:08:00.000Z"),
    });

    const inserted = supabase.calls.find(
      (call) => call.table === "monday_connections" && call.operation === "insert",
    )?.payload as Record<string, unknown>;
    const store = createMondayTokenStore(createSupabaseDouble(inserted));

    await expect(store.get("principal_123")).resolves.toEqual({
      userId: "principal_123",
      mondayAccountId: "account_123",
      mondayUserId: "user_456",
      mondayTeamIds: [],
      accessToken: "monday-access-token",
      accessTokenRef: "monday_connections:principal_123",
      scope: [],
      createdAt: "2026-04-30T15:08:00.000Z",
      updatedAt: "2026-04-30T15:08:00.000Z",
    });
  });

  it("returns deterministic unavailable states for missing inputs and dependencies", async () => {
    await expect(
      persistMondayConnection({
        userId: null,
        connection: {
          accessToken: "token",
          mondayAccountId: "account_123",
          mondayUserId: "user_456",
        },
        supabase: createSupabaseDouble(),
      }),
    ).resolves.toEqual({ status: "unavailable", reason: "missing_user" });

    await expect(
      persistMondayConnection({
        userId: "principal_123",
        connection: {
          accessToken: "",
          mondayAccountId: "account_123",
          mondayUserId: "user_456",
        },
        supabase: createSupabaseDouble(),
      }),
    ).resolves.toEqual({ status: "unavailable", reason: "missing_access_token" });

    delete process.env.AUTH_SECRET;
    delete process.env.NEXTAUTH_SECRET;

    await expect(
      persistMondayConnection({
        userId: "principal_123",
        connection: {
          accessToken: "token",
          mondayAccountId: "account_123",
          mondayUserId: "user_456",
        },
        supabase: createSupabaseDouble(),
      }),
    ).resolves.toEqual({
      status: "unavailable",
      reason: "encryption_secret_missing",
    });

    process.env.AUTH_SECRET = "test-auth-secret-for-monday-tokens";

    await expect(
      persistMondayConnection({
        userId: "principal_123",
        connection: {
          accessToken: "token",
          mondayAccountId: "account_123",
          mondayUserId: "user_456",
        },
        supabase: null,
      }),
    ).resolves.toEqual({ status: "unavailable", reason: "supabase_unavailable" });
  });

  it("treats a missing monday connection table as unavailable instead of throwing", async () => {
    const supabase = createMissingTableSupabaseDouble();

    await expect(
      persistMondayConnection({
        userId: "principal_123",
        connection: {
          accessToken: "token",
          mondayAccountId: "account_123",
          mondayUserId: "user_456",
        },
        supabase,
      }),
    ).resolves.toEqual({ status: "unavailable", reason: "storage_unavailable" });

    await expect(
      hasStoredMondayConnection("principal_123", supabase),
    ).resolves.toEqual({ status: "unavailable", reason: "storage_unavailable" });
  });
});
