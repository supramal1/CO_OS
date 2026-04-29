import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createWorkbenchNotionTokenStore,
  persistWorkbenchNotionOAuthToken,
  type WorkbenchNotionOAuthToken,
} from "@/lib/workbench/notion-token-store";

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

describe("Workbench Notion token persistence", () => {
  const originalAuthSecret = process.env.AUTH_SECRET;
  const originalNextAuthSecret = process.env.NEXTAUTH_SECRET;

  beforeEach(() => {
    process.env.AUTH_SECRET = "test-auth-secret-for-workbench-notion-tokens";
    delete process.env.NEXTAUTH_SECRET;
  });

  afterEach(() => {
    process.env.AUTH_SECRET = originalAuthSecret;
    process.env.NEXTAUTH_SECRET = originalNextAuthSecret;
  });

  it("stores Notion OAuth tokens encrypted with workspace metadata", async () => {
    const supabase = createSupabaseDouble();
    const token: WorkbenchNotionOAuthToken = {
      access_token: "secret-notion-access-token",
      refresh_token: "secret-notion-refresh-token",
      bot_id: "bot-123",
      workspace_id: "workspace-123",
      workspace_name: "Charlie Oscar",
      duplicated_template_id: "template-123",
    };

    const outcome = await persistWorkbenchNotionOAuthToken({
      principalId: "principal_123",
      token,
      supabase,
      now: new Date("2026-04-29T12:00:00.000Z"),
    });

    expect(outcome).toEqual({ status: "stored" });
    const tokenWrite = supabase.calls.find(
      (call) =>
        call.table === "workbench_notion_tokens" &&
        call.operation === "insert",
    );
    expect(tokenWrite?.payload).toMatchObject({
      user_id: "principal_123",
      bot_id: "bot-123",
      workspace_id: "workspace-123",
      workspace_name: "Charlie Oscar",
      duplicated_template_id: "template-123",
      updated_at: "2026-04-29T12:00:00.000Z",
    });
    expect(JSON.stringify(tokenWrite?.payload)).not.toContain(
      "secret-notion-access-token",
    );
    expect(JSON.stringify(tokenWrite?.payload)).not.toContain(
      "secret-notion-refresh-token",
    );
  });

  it("does not overwrite an existing Notion refresh token when one is absent", async () => {
    const supabase = createSupabaseDouble({ user_id: "principal_123" });

    const outcome = await persistWorkbenchNotionOAuthToken({
      principalId: "principal_123",
      token: {
        access_token: "new-secret-access-token",
        bot_id: "bot-123",
      },
      supabase,
      now: new Date("2026-04-29T13:00:00.000Z"),
    });

    expect(outcome).toEqual({ status: "stored" });
    const tokenWrite = supabase.calls.find(
      (call) =>
        call.table === "workbench_notion_tokens" &&
        call.operation === "update.eq",
    );
    expect(tokenWrite?.payload).toMatchObject({
      user_id: "principal_123",
      bot_id: "bot-123",
      updated_at: "2026-04-29T13:00:00.000Z",
    });
    expect(tokenWrite?.payload).not.toHaveProperty("refresh_token_ciphertext");
  });

  it("implements the runtime token store contract for encrypted reads", async () => {
    const supabase = createSupabaseDouble();

    await persistWorkbenchNotionOAuthToken({
      principalId: "principal_123",
      token: {
        access_token: "secret-notion-access-token",
        refresh_token: "secret-notion-refresh-token",
        bot_id: "bot-123",
        workspace_id: "workspace-123",
        workspace_name: "Charlie Oscar",
        duplicated_template_id: "template-123",
      },
      supabase,
    });

    const inserted = supabase.calls.find(
      (call) =>
        call.table === "workbench_notion_tokens" &&
        call.operation === "insert",
    )?.payload as Record<string, unknown>;
    const storeSupabase = createSupabaseDouble(inserted);
    const store = createWorkbenchNotionTokenStore(storeSupabase);

    await expect(store.get("principal_123")).resolves.toEqual({
      accessToken: "secret-notion-access-token",
      refreshToken: "secret-notion-refresh-token",
      botId: "bot-123",
      workspaceId: "workspace-123",
      workspaceName: "Charlie Oscar",
      duplicatedTemplateId: "template-123",
    });
  });

  it("returns deterministic unavailable states for missing persistence inputs", async () => {
    await expect(
      persistWorkbenchNotionOAuthToken({
        principalId: null,
        token: { access_token: "secret" },
        supabase: createSupabaseDouble(),
      }),
    ).resolves.toEqual({
      status: "unavailable",
      reason: "missing_principal",
    });

    await expect(
      persistWorkbenchNotionOAuthToken({
        principalId: "principal_123",
        token: {},
        supabase: createSupabaseDouble(),
      }),
    ).resolves.toEqual({
      status: "unavailable",
      reason: "missing_access_token",
    });

    delete process.env.AUTH_SECRET;
    delete process.env.NEXTAUTH_SECRET;

    await expect(
      persistWorkbenchNotionOAuthToken({
        principalId: "principal_123",
        token: { access_token: "secret" },
        supabase: createSupabaseDouble(),
      }),
    ).resolves.toEqual({
      status: "unavailable",
      reason: "encryption_secret_missing",
    });
  });
});
