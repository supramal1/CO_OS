import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createWorkbenchGoogleTokenStore,
  persistWorkbenchGoogleTokens,
  type WorkbenchGoogleTokenAccount,
} from "@/lib/workbench/google-token-store";

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
        upsert(payload: unknown, options: unknown) {
          calls.push({
            table,
            operation: "upsert",
            payload: { payload, options },
          });
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

describe("Workbench Google token persistence", () => {
  const originalAuthSecret = process.env.AUTH_SECRET;
  const originalNextAuthSecret = process.env.NEXTAUTH_SECRET;

  beforeEach(() => {
    process.env.AUTH_SECRET = "test-auth-secret-for-workbench-google-tokens";
    delete process.env.NEXTAUTH_SECRET;
  });

  afterEach(() => {
    process.env.AUTH_SECRET = originalAuthSecret;
    process.env.NEXTAUTH_SECRET = originalNextAuthSecret;
  });

  it("stores Google account tokens encrypted and updates the Workbench grant config", async () => {
    const supabase = createSupabaseDouble();
    const account: WorkbenchGoogleTokenAccount = {
      provider: "google",
      access_token: "ya29.access-token",
      refresh_token: "1//refresh-token",
      expires_at: 1_776_424_000,
      scope:
        "openid email profile https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/spreadsheets",
      token_type: "Bearer",
    };

    const outcome = await persistWorkbenchGoogleTokens({
      principalId: "principal_123",
      account,
      supabase,
    });

    expect(outcome).toEqual({ status: "stored" });

    const tokenWrite = supabase.calls.find(
      (call) =>
        call.table === "workbench_google_tokens" &&
        call.operation === "insert",
    );
    expect(tokenWrite?.payload).toMatchObject({
      user_id: "principal_123",
      expires_at: "2026-04-17T11:06:40.000Z",
      scope: [
        "openid",
        "email",
        "profile",
        "https://www.googleapis.com/auth/drive.file",
        "https://www.googleapis.com/auth/spreadsheets",
      ],
      token_type: "Bearer",
    });
    expect(JSON.stringify(tokenWrite?.payload)).not.toContain("ya29.access-token");
    expect(JSON.stringify(tokenWrite?.payload)).not.toContain("1//refresh-token");

    const configWrite = supabase.calls.find(
      (call) =>
        call.table === "user_workbench_config" &&
        call.operation === "upsert",
    );
    expect(configWrite).toMatchObject({
      payload: {
        payload: {
          user_id: "principal_123",
          google_oauth_grant_status: "granted",
          google_oauth_scopes: [
            "openid",
            "email",
            "profile",
            "https://www.googleapis.com/auth/drive.file",
            "https://www.googleapis.com/auth/spreadsheets",
          ],
        },
        options: { onConflict: "user_id" },
      },
    });
  });

  it("does not overwrite an existing refresh token when Google omits refresh_token", async () => {
    const supabase = createSupabaseDouble({ user_id: "principal_123" });

    const outcome = await persistWorkbenchGoogleTokens({
      principalId: "principal_123",
      account: {
        provider: "google",
        access_token: "new-access-token",
        expires_in: 3600,
        scope: "https://www.googleapis.com/auth/drive.file",
        token_type: "Bearer",
      },
      supabase,
      now: new Date("2026-04-29T10:00:00.000Z"),
    });

    expect(outcome).toEqual({ status: "stored" });

    const tokenWrite = supabase.calls.find(
      (call) =>
        call.table === "workbench_google_tokens" &&
        call.operation === "update.eq",
    );
    expect(tokenWrite?.payload).toMatchObject({
      user_id: "principal_123",
      expires_at: "2026-04-29T11:00:00.000Z",
    });
    expect(tokenWrite?.payload).not.toHaveProperty("refresh_token_ciphertext");
  });

  it("implements the runtime token store contract for reads and access-token updates", async () => {
    const supabase = createSupabaseDouble();
    const account: WorkbenchGoogleTokenAccount = {
      provider: "google",
      access_token: "ya29.access-token",
      refresh_token: "1//refresh-token",
      expires_at: 1_777_486_400,
      scope: "https://www.googleapis.com/auth/drive.file",
      token_type: "Bearer",
    };

    await persistWorkbenchGoogleTokens({
      principalId: "principal_123",
      account,
      supabase,
    });

    const inserted = supabase.calls.find(
      (call) =>
        call.table === "workbench_google_tokens" &&
        call.operation === "insert",
    )?.payload as Record<string, unknown>;
    const storeSupabase = createSupabaseDouble(inserted);
    const store = createWorkbenchGoogleTokenStore(storeSupabase);

    await expect(store.get("principal_123")).resolves.toEqual({
      accessToken: "ya29.access-token",
      refreshToken: "1//refresh-token",
      expiresAtMs: 1_777_486_400_000,
    });

    await store.updateAccessToken({
      principalId: "principal_123",
      accessToken: "new-access-token",
      expiresAtMs: 1_777_490_000_000,
    });

    const update = storeSupabase.calls.find(
      (call) =>
        call.table === "workbench_google_tokens" &&
        call.operation === "update.eq",
    );
    expect(update?.payload).toMatchObject({
      expires_at: new Date(1_777_490_000_000).toISOString(),
    });
    expect(JSON.stringify(update?.payload)).not.toContain("new-access-token");
  });
});
