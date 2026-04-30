import { describe, expect, it } from "vitest";
import {
  DEFAULT_MONDAY_OAUTH_AUTH_URL,
  createMondayAuthorizationUrl,
  getMondayOAuthConfig,
  signMondayOAuthState,
  verifyMondayOAuthState,
} from "@/lib/monday/oauth";

describe("monday OAuth foundation", () => {
  const env = {
    MONDAY_CLIENT_ID: "monday-client-id",
    MONDAY_CLIENT_SECRET: "monday-client-secret",
    AUTH_SECRET: "test-auth-secret-for-monday",
  };

  it("detects missing runtime config without exposing secrets", () => {
    expect(getMondayOAuthConfig({ origin: "https://co-os.test", env: {} })).toEqual({
      status: "unavailable",
      reason: "monday_client_id_missing",
    });
    expect(
      getMondayOAuthConfig({
        origin: "https://co-os.test",
        env: { MONDAY_CLIENT_ID: "client-id" },
      }),
    ).toEqual({
      status: "unavailable",
      reason: "monday_client_secret_missing",
    });
  });

  it("derives the callback URL from request origin when config is ready", () => {
    expect(
      getMondayOAuthConfig({
        origin: "https://co-os.test",
        env,
      }),
    ).toEqual({
      status: "ready",
      clientId: "monday-client-id",
      clientSecret: "monday-client-secret",
      redirectUri: "https://co-os.test/api/monday/callback",
      authUrl: DEFAULT_MONDAY_OAUTH_AUTH_URL,
    });
  });

  it("builds a monday authorization URL bound to the signed-in principal", () => {
    const result = createMondayAuthorizationUrl({
      origin: "https://co-os.test",
      principalId: "principal_123",
      env,
      now: new Date("2026-04-30T10:00:00.000Z"),
    });

    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;

    expect(`${result.url.origin}${result.url.pathname}`).toBe(
      DEFAULT_MONDAY_OAUTH_AUTH_URL,
    );
    expect(result.url.searchParams.get("client_id")).toBe("monday-client-id");
    expect(result.url.searchParams.get("redirect_uri")).toBe(
      "https://co-os.test/api/monday/callback",
    );
    expect(result.url.searchParams.get("response_type")).toBe("code");

    const state = result.url.searchParams.get("state");
    expect(state).toBeTruthy();
    expect(state).not.toContain("principal_123");
    expect(
      verifyMondayOAuthState({
        state,
        principalId: "principal_123",
        env,
        now: new Date("2026-04-30T10:01:00.000Z"),
      }),
    ).toMatchObject({ status: "valid" });
  });

  it("rejects missing, malformed, and mismatched callback state", () => {
    expect(
      verifyMondayOAuthState({
        state: null,
        principalId: "principal_123",
        env,
      }),
    ).toEqual({ status: "invalid", reason: "monday_oauth_state_missing" });

    expect(
      verifyMondayOAuthState({
        state: "not-a-valid-state",
        principalId: "principal_123",
        env,
      }),
    ).toEqual({ status: "invalid", reason: "monday_oauth_state_malformed" });

    const state = signMondayOAuthState({
      principalId: "principal_123",
      env,
      nonce: "nonce-123",
      now: new Date("2026-04-30T10:00:00.000Z"),
    });
    expect(
      verifyMondayOAuthState({
        state,
        principalId: "principal_456",
        env,
        now: new Date("2026-04-30T10:01:00.000Z"),
      }),
    ).toEqual({
      status: "invalid",
      reason: "monday_oauth_state_principal_mismatch",
    });
  });
});
