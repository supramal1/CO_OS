import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  getToken: vi.fn(),
  headers: vi.fn(),
}));

vi.mock("@/auth", () => ({
  auth: () => mocks.auth(),
}));

vi.mock("server-only", () => ({}));

vi.mock("next-auth/jwt", () => ({
  getToken: (...args: unknown[]) => mocks.getToken(...args),
}));

vi.mock("next/headers", () => ({
  headers: () => mocks.headers(),
}));

import { authWithApiKey } from "@/lib/server-auth";

beforeEach(() => {
  mocks.auth.mockReset();
  mocks.getToken.mockReset();
  mocks.headers.mockReset();
  process.env.AUTH_SECRET = "auth-secret";
  delete process.env.NEXTAUTH_SECRET;
  delete process.env.AUTH_URL;
  delete process.env.NEXTAUTH_URL;
});

describe("authWithApiKey", () => {
  it("keeps the client session redacted while resolving apiKey server-side", async () => {
    const requestHeaders = new Headers({ cookie: "authjs.session-token=value" });
    mocks.auth.mockResolvedValue({
      principalId: "principal_staff",
      isAdmin: true,
      user: { email: "staff@example.com" },
    });
    mocks.headers.mockResolvedValue(requestHeaders);
    mocks.getToken.mockResolvedValue({
      principalId: "principal_staff",
      apiKey: "csk_server_only",
    });

    const session = await authWithApiKey();

    expect(session).toMatchObject({
      principalId: "principal_staff",
      isAdmin: true,
      apiKey: "csk_server_only",
    });
    expect(mocks.getToken).toHaveBeenCalledWith({
      req: { headers: requestHeaders },
      secret: "auth-secret",
      secureCookie: false,
    });
  });

  it("uses mocked legacy session apiKey only in tests", async () => {
    mocks.auth.mockResolvedValue({
      principalId: "principal_staff",
      apiKey: "csk_test_only",
    });

    await expect(authWithApiKey()).resolves.toMatchObject({
      principalId: "principal_staff",
      apiKey: "csk_test_only",
    });
    expect(mocks.getToken).not.toHaveBeenCalled();
  });

  it("uses the same local fallback secret as Auth.js when env secrets are absent", async () => {
    delete process.env.AUTH_SECRET;
    delete process.env.NEXTAUTH_SECRET;
    const requestHeaders = new Headers({ cookie: "authjs.session-token=value" });
    mocks.auth.mockResolvedValue({
      principalId: "principal_staff",
      isAdmin: false,
      user: { email: "staff@example.com" },
    });
    mocks.headers.mockResolvedValue(requestHeaders);
    mocks.getToken.mockResolvedValue({
      principalId: "principal_staff",
      apiKey: "csk_from_fallback_secret",
    });

    await expect(authWithApiKey()).resolves.toMatchObject({
      principalId: "principal_staff",
      apiKey: "csk_from_fallback_secret",
    });
    expect(mocks.getToken).toHaveBeenCalledWith({
      req: { headers: requestHeaders },
      secret: "co-os-local-development-secret",
      secureCookie: false,
    });
  });
});
