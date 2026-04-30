import { describe, expect, it } from "vitest";
import {
  getWorkbenchGoogleAccessToken,
  type WorkbenchGoogleTokenStore,
} from "@/lib/workbench/google-token";

function createTokenStore(
  stored: Awaited<ReturnType<WorkbenchGoogleTokenStore["get"]>>,
) {
  const updates: Array<{
    principalId: string;
    accessToken: string;
    expiresAtMs: number;
  }> = [];
  const tokenStore: WorkbenchGoogleTokenStore = {
    async get(principalId) {
      expect(principalId).toBe("principal_123");
      return stored;
    },
    async updateAccessToken(update) {
      updates.push(update);
    },
  };

  return { tokenStore, updates };
}

describe("Workbench Google token runtime helper", () => {
  it("returns an unexpired stored access token without refreshing", async () => {
    const { tokenStore, updates } = createTokenStore({
      accessToken: "stored-access-token",
      refreshToken: "stored-refresh-token",
      expiresAtMs: Date.parse("2026-04-29T13:00:00.000Z"),
    });

    const result = await getWorkbenchGoogleAccessToken({
      principalId: "principal_123",
      now: new Date("2026-04-29T12:00:00.000Z"),
      tokenStore,
      fetch: async () => {
        throw new Error("refresh should not be called");
      },
    });

    expect(result).toEqual({
      status: "available",
      accessToken: "stored-access-token",
      refreshed: false,
    });
    expect(updates).toEqual([]);
  });

  it("refreshes an expired token, persists it, and returns the new access token", async () => {
    const { tokenStore, updates } = createTokenStore({
      accessToken: "expired-access-token",
      refreshToken: "refresh-token",
      expiresAtMs: Date.parse("2026-04-29T11:59:00.000Z"),
    });
    const requests: Array<{ url: string; body: string }> = [];

    const result = await getWorkbenchGoogleAccessToken({
      principalId: "principal_123",
      now: new Date("2026-04-29T12:00:00.000Z"),
      tokenStore,
      clientId: "client-id",
      clientSecret: "client-secret",
      fetch: async (url, init) => {
        requests.push({
          url: String(url),
          body: String(init?.body),
        });
        return new Response(
          JSON.stringify({
            access_token: "new-access-token",
            expires_in: 3600,
            token_type: "Bearer",
          }),
          { status: 200 },
        );
      },
    });

    expect(result).toEqual({
      status: "available",
      accessToken: "new-access-token",
      refreshed: true,
    });
    expect(requests).toEqual([
      {
        url: "https://oauth2.googleapis.com/token",
        body: "client_id=client-id&client_secret=client-secret&refresh_token=refresh-token&grant_type=refresh_token",
      },
    ]);
    expect(updates).toEqual([
      {
        principalId: "principal_123",
        accessToken: "new-access-token",
        expiresAtMs: Date.parse("2026-04-29T13:00:00.000Z"),
      },
    ]);
  });

  it("returns typed unavailable when a refresh token is missing", async () => {
    const { tokenStore } = createTokenStore({
      accessToken: "expired-access-token",
      refreshToken: null,
      expiresAtMs: Date.parse("2026-04-29T11:59:00.000Z"),
    });

    const result = await getWorkbenchGoogleAccessToken({
      principalId: "principal_123",
      now: new Date("2026-04-29T12:00:00.000Z"),
      tokenStore,
      fetch: async () => {
        throw new Error("refresh should not be called");
      },
    });

    expect(result).toEqual({
      status: "unavailable",
      reason: "google_refresh_token_missing",
    });
  });

  it("returns typed error when Google rejects a refresh request", async () => {
    const { tokenStore } = createTokenStore({
      accessToken: "expired-access-token",
      refreshToken: "refresh-token",
      expiresAtMs: Date.parse("2026-04-29T11:59:00.000Z"),
    });

    const result = await getWorkbenchGoogleAccessToken({
      principalId: "principal_123",
      now: new Date("2026-04-29T12:00:00.000Z"),
      tokenStore,
      clientId: "client-id",
      clientSecret: "client-secret",
      fetch: async () =>
        new Response(
          JSON.stringify({
            error: "invalid_grant",
            error_description: "Bad refresh token",
          }),
          { status: 400 },
        ),
    });

    expect(result).toEqual({
      status: "error",
      reason: "google_token_refresh_failed",
      message: "Bad refresh token",
    });
  });
});
