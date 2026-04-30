import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  generateNewsroomBrief: vi.fn(),
}));

vi.mock("@/lib/server-auth", () => ({
  authWithApiKey: () => mocks.auth(),
}));

vi.mock("@/lib/newsroom/brief", () => ({
  generateNewsroomBrief: (...args: unknown[]) =>
    mocks.generateNewsroomBrief(...args),
}));

import { dynamic, GET } from "@/app/api/newsroom/brief/route";

describe("GET /api/newsroom/brief", () => {
  beforeEach(() => {
    mocks.auth.mockReset();
    mocks.generateNewsroomBrief.mockReset();
  });

  it("exports a force-dynamic route", () => {
    expect(dynamic).toBe("force-dynamic");
  });

  it("returns 401 without calling the generator when unauthenticated", async () => {
    mocks.auth.mockResolvedValue(null);

    const res = await GET();

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthenticated" });
    expect(mocks.generateNewsroomBrief).not.toHaveBeenCalled();
  });

  it("returns a generated brief for an authenticated principal", async () => {
    const brief = {
      userId: "principal_user_1",
      generatedAt: "2026-04-30T09:00:00.000Z",
      today: [],
    };
    mocks.auth.mockResolvedValue({
      principalId: "principal_user_1",
      apiKey: "csk_test",
    });
    mocks.generateNewsroomBrief.mockResolvedValue(brief);

    const res = await GET();

    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    expect(res.headers.get("X-Newsroom-Cache")).toBe("miss");
    expect(await res.json()).toEqual({ brief });
    expect(mocks.generateNewsroomBrief).toHaveBeenCalledExactlyOnceWith({
      userId: "principal_user_1",
      apiKey: "csk_test",
    });
  });
});
