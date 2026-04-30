import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  buildProfileSnapshot: vi.fn(),
}));

vi.mock("@/auth", () => ({
  auth: () => mocks.auth(),
}));

vi.mock("@/lib/profile/profile-snapshot", () => ({
  buildProfileSnapshot: (...args: unknown[]) =>
    mocks.buildProfileSnapshot(...args),
}));

import { dynamic, GET } from "@/app/api/profile/route";

describe("GET /api/profile", () => {
  beforeEach(() => {
    mocks.auth.mockReset();
    mocks.buildProfileSnapshot.mockReset();
  });

  it("exports a force-dynamic route", () => {
    expect(dynamic).toBe("force-dynamic");
  });

  it("returns 401 when the user is not signed in", async () => {
    mocks.auth.mockResolvedValue(null);

    const res = await GET();

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthenticated" });
    expect(mocks.buildProfileSnapshot).not.toHaveBeenCalled();
  });

  it("returns the current profile snapshot for the signed-in user", async () => {
    const session = {
      principalId: "principal_123",
      isAdmin: false,
      user: { email: "malik@example.com", name: "Malik" },
    };
    const snapshot = {
      identity: { userId: "principal_123", email: "malik@example.com" },
      connectedTools: [],
    };
    mocks.auth.mockResolvedValue(session);
    mocks.buildProfileSnapshot.mockResolvedValue(snapshot);

    const res = await GET();

    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    expect(await res.json()).toEqual({ profile: snapshot });
    expect(mocks.buildProfileSnapshot).toHaveBeenCalledExactlyOnceWith({
      session,
    });
  });
});
