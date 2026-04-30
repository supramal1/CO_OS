import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
}));

vi.mock("@/auth", () => ({
  auth: () => mocks.auth(),
}));

import { GET as callbackGET } from "@/app/api/monday/callback/route";
import { GET as startGET } from "@/app/api/monday/start/route";
import { type MondayOAuthEnv, signMondayOAuthState } from "@/lib/monday/oauth";

function request(url: string): NextRequest {
  return new Request(url) as unknown as NextRequest;
}

function testEnv(): MondayOAuthEnv {
  return {
    MONDAY_CLIENT_ID: process.env.MONDAY_CLIENT_ID,
    MONDAY_CLIENT_SECRET: process.env.MONDAY_CLIENT_SECRET,
    MONDAY_OAUTH_AUTH_URL: process.env.MONDAY_OAUTH_AUTH_URL,
    AUTH_SECRET: process.env.AUTH_SECRET,
    NEXTAUTH_SECRET: process.env.NEXTAUTH_SECRET,
  };
}

describe("monday OAuth routes", () => {
  const originalEnv = {
    AUTH_SECRET: process.env.AUTH_SECRET,
    NEXTAUTH_SECRET: process.env.NEXTAUTH_SECRET,
    MONDAY_CLIENT_ID: process.env.MONDAY_CLIENT_ID,
    MONDAY_CLIENT_SECRET: process.env.MONDAY_CLIENT_SECRET,
    MONDAY_OAUTH_AUTH_URL: process.env.MONDAY_OAUTH_AUTH_URL,
  };

  beforeEach(() => {
    mocks.auth.mockReset();
    process.env.AUTH_SECRET = "test-auth-secret-for-monday-routes";
    delete process.env.NEXTAUTH_SECRET;
    process.env.MONDAY_CLIENT_ID = "monday-client-id";
    process.env.MONDAY_CLIENT_SECRET = "monday-client-secret";
    delete process.env.MONDAY_OAUTH_AUTH_URL;
  });

  afterEach(() => {
    process.env.AUTH_SECRET = originalEnv.AUTH_SECRET;
    process.env.NEXTAUTH_SECRET = originalEnv.NEXTAUTH_SECRET;
    process.env.MONDAY_CLIENT_ID = originalEnv.MONDAY_CLIENT_ID;
    process.env.MONDAY_CLIENT_SECRET = originalEnv.MONDAY_CLIENT_SECRET;
    process.env.MONDAY_OAUTH_AUTH_URL = originalEnv.MONDAY_OAUTH_AUTH_URL;
  });

  it("requires auth before starting monday OAuth", async () => {
    mocks.auth.mockResolvedValue(null);

    const res = await startGET(request("https://co-os.test/api/monday/start"));

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthenticated" });
  });

  it("returns human-readable setup status when monday OAuth is not configured", async () => {
    mocks.auth.mockResolvedValue({ principalId: "principal_123" });
    delete process.env.MONDAY_CLIENT_ID;

    const res = await startGET(request("https://co-os.test/api/monday/start"));

    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({
      error: "monday_oauth_unavailable",
      reason: "monday_client_id_missing",
      message:
        "monday OAuth is not configured. Add MONDAY_CLIENT_ID and MONDAY_CLIENT_SECRET before connecting users.",
    });
  });

  it("redirects authenticated users to monday authorization", async () => {
    mocks.auth.mockResolvedValue({ principalId: "principal_123" });

    const res = await startGET(request("https://co-os.test/api/monday/start"));

    expect(res.status).toBe(307);
    const location = res.headers.get("location");
    expect(location).toBeTruthy();
    const url = new URL(location ?? "");
    expect(`${url.origin}${url.pathname}`).toBe(
      "https://auth.monday.com/oauth2/authorize",
    );
    expect(url.searchParams.get("client_id")).toBe("monday-client-id");
    expect(url.searchParams.get("redirect_uri")).toBe(
      "https://co-os.test/api/monday/callback",
    );
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("state")).toBeTruthy();
  });

  it("requires auth on callback", async () => {
    mocks.auth.mockResolvedValue(null);

    const res = await callbackGET(
      request("https://co-os.test/api/monday/callback?code=abc&state=xyz"),
    );

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthenticated" });
  });

  it("validates missing callback code and state before token persistence exists", async () => {
    mocks.auth.mockResolvedValue({ principalId: "principal_123" });

    const missingState = await callbackGET(
      request("https://co-os.test/api/monday/callback?code=abc"),
    );
    expect(missingState.status).toBe(400);
    expect(await missingState.json()).toEqual({
      error: "monday_oauth_error",
      reason: "monday_oauth_state_missing",
    });

    const state = signMondayOAuthState({
      principalId: "principal_123",
      env: testEnv(),
      nonce: "nonce-123",
    });
    const missingCode = await callbackGET(
      request(
        `https://co-os.test/api/monday/callback?state=${encodeURIComponent(
          state,
        )}`,
      ),
    );
    expect(missingCode.status).toBe(400);
    expect(await missingCode.json()).toEqual({
      error: "monday_oauth_error",
      reason: "monday_oauth_code_missing",
    });
  });

  it("returns a clear placeholder for Dev 2 token persistence", async () => {
    mocks.auth.mockResolvedValue({ principalId: "principal_123" });
    const state = signMondayOAuthState({
      principalId: "principal_123",
      env: testEnv(),
      nonce: "nonce-123",
    });

    const res = await callbackGET(
      request(
        `https://co-os.test/api/monday/callback?code=oauth-code&state=${encodeURIComponent(
          state,
        )}`,
      ),
    );

    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({
      status: "pending_token_persistence",
      message:
        "monday OAuth callback validated. Token exchange and encrypted persistence are intentionally not implemented in this foundation slice.",
    });
  });
});
