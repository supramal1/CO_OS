import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";
import {
  DEFAULT_NOTION_OAUTH_AUTH_URL,
  exchangeWorkbenchNotionOAuthCode,
  getWorkbenchNotionOAuthConfig,
  signWorkbenchNotionOAuthState,
  verifyWorkbenchNotionOAuthState,
} from "@/lib/workbench/notion-oauth";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  persistWorkbenchNotionOAuthToken: vi.fn(),
  ensureWorkbenchNotionSetup: vi.fn(),
  getUserWorkbenchConfig: vi.fn(),
  patchWorkbenchUserConfig: vi.fn(),
}));

vi.mock("@/auth", () => ({
  auth: () => mocks.auth(),
}));

vi.mock("@/lib/workbench/notion-token-store", () => ({
  persistWorkbenchNotionOAuthToken: (...args: unknown[]) =>
    mocks.persistWorkbenchNotionOAuthToken(...args),
}));

vi.mock("@/lib/workbench/notion-setup", () => ({
  ensureWorkbenchNotionSetup: (...args: unknown[]) =>
    mocks.ensureWorkbenchNotionSetup(...args),
}));

vi.mock("@/lib/workbench/retrieval/config", () => ({
  getUserWorkbenchConfig: (...args: unknown[]) =>
    mocks.getUserWorkbenchConfig(...args),
}));

vi.mock("@/lib/workbench/user-config", () => ({
  patchWorkbenchUserConfig: (...args: unknown[]) =>
    mocks.patchWorkbenchUserConfig(...args),
}));

import { GET as callbackGET } from "@/app/api/workbench/notion/callback/route";
import { GET as startGET } from "@/app/api/workbench/notion/start/route";

function request(url: string): NextRequest {
  return new Request(url) as unknown as NextRequest;
}

describe("Workbench Notion OAuth foundation", () => {
  const originalEnv = {
    AUTH_SECRET: process.env.AUTH_SECRET,
    NEXTAUTH_SECRET: process.env.NEXTAUTH_SECRET,
    NOTION_OAUTH_CLIENT_ID: process.env.NOTION_OAUTH_CLIENT_ID,
    NOTION_OAUTH_CLIENT_SECRET: process.env.NOTION_OAUTH_CLIENT_SECRET,
    NOTION_OAUTH_REDIRECT_URI: process.env.NOTION_OAUTH_REDIRECT_URI,
    NOTION_OAUTH_AUTH_URL: process.env.NOTION_OAUTH_AUTH_URL,
  };

  beforeEach(() => {
    vi.unstubAllGlobals();
    mocks.auth.mockReset();
    mocks.persistWorkbenchNotionOAuthToken.mockReset();
    mocks.ensureWorkbenchNotionSetup.mockReset();
    mocks.getUserWorkbenchConfig.mockReset();
    mocks.patchWorkbenchUserConfig.mockReset();
    mocks.ensureWorkbenchNotionSetup.mockResolvedValue({
      status: "created",
      parent_id: "notion-parent-1",
      child_ids: {
        "Personal Profile": "child-personal-profile",
        "Working On": "child-working-on",
        Patterns: "child-patterns",
        References: "child-references",
        Voice: "child-voice",
      },
      counts: { created: 6, validated: 0, repaired: 0 },
    });
    mocks.getUserWorkbenchConfig.mockResolvedValue(null);
    mocks.patchWorkbenchUserConfig.mockResolvedValue({
      status: "ok",
      config: null,
      google_readiness: null,
    });
    process.env.AUTH_SECRET = "test-secret-for-notion-oauth-state";
    delete process.env.NEXTAUTH_SECRET;
    process.env.NOTION_OAUTH_CLIENT_ID = "notion-client-id";
    process.env.NOTION_OAUTH_CLIENT_SECRET = "notion-client-secret";
    process.env.NOTION_OAUTH_REDIRECT_URI =
      "https://co-os.test/api/workbench/notion/callback";
    delete process.env.NOTION_OAUTH_AUTH_URL;
  });

  afterEach(() => {
    process.env.AUTH_SECRET = originalEnv.AUTH_SECRET;
    process.env.NEXTAUTH_SECRET = originalEnv.NEXTAUTH_SECRET;
    process.env.NOTION_OAUTH_CLIENT_ID = originalEnv.NOTION_OAUTH_CLIENT_ID;
    process.env.NOTION_OAUTH_CLIENT_SECRET =
      originalEnv.NOTION_OAUTH_CLIENT_SECRET;
    process.env.NOTION_OAUTH_REDIRECT_URI =
      originalEnv.NOTION_OAUTH_REDIRECT_URI;
    process.env.NOTION_OAUTH_AUTH_URL = originalEnv.NOTION_OAUTH_AUTH_URL;
    vi.unstubAllGlobals();
  });

  it("returns typed unavailable config reasons for missing Notion OAuth env", () => {
    expect(getWorkbenchNotionOAuthConfig({})).toEqual({
      status: "unavailable",
      reason: "notion_oauth_client_id_missing",
    });
    expect(
      getWorkbenchNotionOAuthConfig({
        NOTION_OAUTH_CLIENT_ID: "client-id",
      }),
    ).toEqual({
      status: "unavailable",
      reason: "notion_oauth_client_secret_missing",
    });
    expect(
      getWorkbenchNotionOAuthConfig({
        NOTION_OAUTH_CLIENT_ID: "client-id",
        NOTION_OAUTH_CLIENT_SECRET: "client-secret",
      }),
    ).toEqual({
      status: "unavailable",
      reason: "notion_oauth_redirect_uri_missing",
    });
  });

  it("builds the Notion authorize redirect for the authenticated principal", async () => {
    mocks.auth.mockResolvedValue({
      principalId: "principal_123",
      apiKey: "session-key-123",
    });

    const res = await startGET();

    expect(res.status).toBe(307);
    const location = res.headers.get("location");
    expect(location).toBeTruthy();
    const url = new URL(location ?? "");
    expect(`${url.origin}${url.pathname}`).toBe(DEFAULT_NOTION_OAUTH_AUTH_URL);
    expect(url.searchParams.get("client_id")).toBe("notion-client-id");
    expect(url.searchParams.get("redirect_uri")).toBe(
      "https://co-os.test/api/workbench/notion/callback",
    );
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("owner")).toBe("user");

    const state = url.searchParams.get("state");
    expect(state).toBeTruthy();
    expect(state).not.toContain("principal_123");
    expect(state).not.toContain("session-key-123");
    expect(
      verifyWorkbenchNotionOAuthState({
        state: state ?? "",
        principalId: "principal_123",
        sessionBinding: "principal_123",
        now: new Date(),
      }),
    ).toMatchObject({ status: "valid" });
  });

  it("rejects Notion OAuth start without an authenticated principal", async () => {
    mocks.auth.mockResolvedValue(null);

    const res = await startGET();

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthenticated" });
  });

  it("returns a deterministic unavailable response when start config is missing", async () => {
    mocks.auth.mockResolvedValue({ principalId: "principal_123" });
    delete process.env.NOTION_OAUTH_CLIENT_ID;

    const res = await startGET();

    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({
      error: "workbench_notion_oauth_unavailable",
      reason: "notion_oauth_client_id_missing",
    });
  });

  it("exchanges the callback code with Notion Basic auth and persists the token", async () => {
    mocks.auth.mockResolvedValue({
      principalId: "principal_123",
      apiKey: "session-key-123",
    });
    mocks.persistWorkbenchNotionOAuthToken.mockResolvedValue({ status: "stored" });
    const state = signWorkbenchNotionOAuthState({
      principalId: "principal_123",
      sessionBinding: "principal_123",
      nonce: "nonce-123",
    });
    const fetchCalls: Array<{
      url: string;
      headers: Record<string, string>;
      body: unknown;
    }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
        fetchCalls.push({
          url: String(url),
          headers: init?.headers as Record<string, string>,
          body: JSON.parse(String(init?.body)),
        });
        return new Response(
          JSON.stringify({
            access_token: "secret-access-token",
            refresh_token: "secret-refresh-token",
            bot_id: "bot-123",
            workspace_id: "workspace-123",
            workspace_name: "Charlie Oscar",
            duplicated_template_id: "template-123",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }),
    );

    const res = await callbackGET(
      request(
        `https://co-os.test/api/workbench/notion/callback?code=oauth-code&state=${encodeURIComponent(
          state,
        )}`,
      ),
    );

    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("https://co-os.test/workbench");
    expect(fetchCalls).toEqual([
      {
        url: "https://api.notion.com/v1/oauth/token",
        headers: {
          Authorization: `Basic ${Buffer.from(
            "notion-client-id:notion-client-secret",
          ).toString("base64")}`,
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: {
          grant_type: "authorization_code",
          code: "oauth-code",
          redirect_uri: "https://co-os.test/api/workbench/notion/callback",
        },
      },
    ]);
    expect(mocks.persistWorkbenchNotionOAuthToken).toHaveBeenCalledWith({
      principalId: "principal_123",
      token: {
        access_token: "secret-access-token",
        refresh_token: "secret-refresh-token",
        bot_id: "bot-123",
        workspace_id: "workspace-123",
        workspace_name: "Charlie Oscar",
        duplicated_template_id: "template-123",
      },
    });
    expect(mocks.getUserWorkbenchConfig).toHaveBeenCalledWith("principal_123");
    expect(mocks.ensureWorkbenchNotionSetup).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "principal_123",
        config: null,
        token: "secret-access-token",
        updateConfig: expect.any(Function),
      }),
    );
    const setupInput = mocks.ensureWorkbenchNotionSetup.mock.calls[0]?.[0];
    await setupInput.updateConfig({
      userId: "principal_123",
      notion_parent_page_id: "notion-parent-1",
    });
    expect(mocks.patchWorkbenchUserConfig).toHaveBeenCalledWith(
      "principal_123",
      { notion_parent_page_id: "notion-parent-1" },
    );
    expect(res.headers.get("location")).not.toContain("secret-access-token");
    expect(res.headers.get("location")).not.toContain("secret-refresh-token");
  });

  it("exposes the lower-level token exchange without leaking failed response bodies", async () => {
    const fetcher = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          error: "invalid_grant",
          access_token: "do-not-leak",
        }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    });

    await expect(
      exchangeWorkbenchNotionOAuthCode({
        code: "bad-code",
        env: {
          NOTION_OAUTH_CLIENT_ID: "client-id",
          NOTION_OAUTH_CLIENT_SECRET: "client-secret",
          NOTION_OAUTH_REDIRECT_URI:
            "https://co-os.test/api/workbench/notion/callback",
        },
        fetch: fetcher as unknown as typeof fetch,
      }),
    ).resolves.toEqual({
      status: "error",
      reason: "notion_token_exchange_failed",
      statusCode: 400,
    });
  });
});
