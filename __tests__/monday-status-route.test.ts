import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  getMondayConnectionStatus: vi.fn(),
}));

vi.mock("@/auth", () => ({
  auth: () => mocks.auth(),
}));

vi.mock("@/lib/monday/status", () => ({
  getMondayConnectionStatus: (...args: unknown[]) =>
    mocks.getMondayConnectionStatus(...args),
}));

import { dynamic, GET } from "@/app/api/monday/status/route";

describe("GET /api/monday/status", () => {
  beforeEach(() => {
    mocks.auth.mockReset();
    mocks.getMondayConnectionStatus.mockReset();
  });

  it("exports a force-dynamic route", () => {
    expect(dynamic).toBe("force-dynamic");
  });

  it("returns 401 when unauthenticated", async () => {
    mocks.auth.mockResolvedValue(null);

    const res = await GET();

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthenticated" });
    expect(mocks.getMondayConnectionStatus).not.toHaveBeenCalled();
  });

  it("returns the current user's monday connection status", async () => {
    mocks.auth.mockResolvedValue({ principalId: "principal_123" });
    mocks.getMondayConnectionStatus.mockReturnValue({
      source: "monday",
      state: "not_configured",
      connected: false,
      configured: false,
      message: "monday connector is not configured yet.",
      actionLabel: "Set up",
      nextUrl: "/profile",
    });

    const res = await GET();

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      status: {
        source: "monday",
        state: "not_configured",
        connected: false,
        configured: false,
        message: "monday connector is not configured yet.",
        actionLabel: "Set up",
        nextUrl: "/profile",
      },
    });
    expect(mocks.getMondayConnectionStatus).toHaveBeenCalledExactlyOnceWith({
      userId: "principal_123",
    });
  });
});
