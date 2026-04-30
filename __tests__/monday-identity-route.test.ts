import type { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  resolveMondayIdentity: vi.fn(),
  confirmMondayIdentity: vi.fn(),
}));

vi.mock("@/auth", () => ({
  auth: () => mocks.auth(),
}));

vi.mock("@/lib/monday/identity", () => ({
  resolveMondayIdentity: (...args: unknown[]) =>
    mocks.resolveMondayIdentity(...args),
  confirmMondayIdentity: (...args: unknown[]) =>
    mocks.confirmMondayIdentity(...args),
}));

import {
  dynamic as confirmDynamic,
  POST,
} from "@/app/api/monday/identity/confirm/route";
import { dynamic, GET } from "@/app/api/monday/identity/route";

describe("GET /api/monday/identity", () => {
  beforeEach(() => {
    mocks.auth.mockReset();
    mocks.resolveMondayIdentity.mockReset();
    mocks.confirmMondayIdentity.mockReset();
  });

  it("exports a force-dynamic route", () => {
    expect(dynamic).toBe("force-dynamic");
  });

  it("requires auth", async () => {
    mocks.auth.mockResolvedValue(null);

    const res = await GET();

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthenticated" });
    expect(mocks.resolveMondayIdentity).not.toHaveBeenCalled();
  });

  it("returns the current user's monday identity resolution", async () => {
    mocks.auth.mockResolvedValue({
      principalId: "principal_123",
      user: {
        name: "Malik James-Williams",
        email: "malik@example.com",
      },
    });
    mocks.resolveMondayIdentity.mockReturnValue({
      source: "monday",
      status: "disconnected",
      configured: true,
      identity: null,
      message: "Connect monday to resolve identity.",
    });

    const res = await GET();

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      identity: {
        source: "monday",
        status: "disconnected",
        configured: true,
        identity: null,
        message: "Connect monday to resolve identity.",
      },
    });
    expect(mocks.resolveMondayIdentity).toHaveBeenCalledExactlyOnceWith({
      userId: "principal_123",
      name: "Malik James-Williams",
      email: "malik@example.com",
    });
  });
});

describe("POST /api/monday/identity/confirm", () => {
  beforeEach(() => {
    mocks.auth.mockReset();
    mocks.resolveMondayIdentity.mockReset();
    mocks.confirmMondayIdentity.mockReset();
  });

  it("exports a force-dynamic route", () => {
    expect(confirmDynamic).toBe("force-dynamic");
  });

  it("requires auth", async () => {
    mocks.auth.mockResolvedValue(null);

    const res = await POST(request({ mondayUserId: "1", mondayAccountId: "2" }));

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthenticated" });
    expect(mocks.confirmMondayIdentity).not.toHaveBeenCalled();
  });

  it("returns 400 for invalid confirmation payloads", async () => {
    mocks.auth.mockResolvedValue({ principalId: "principal_123" });
    mocks.confirmMondayIdentity.mockResolvedValue({
      accepted: false,
      status: "invalid",
      message: "mondayUserId and mondayAccountId are required.",
      identity: null,
    });

    const res = await POST(request({ mondayUserId: "" }));

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      confirmation: {
        accepted: false,
        status: "invalid",
        message: "mondayUserId and mondayAccountId are required.",
        identity: null,
      },
    });
  });

  it("returns unavailable when persistence is not wired yet", async () => {
    mocks.auth.mockResolvedValue({ principalId: "principal_123" });
    mocks.confirmMondayIdentity.mockResolvedValue({
      accepted: false,
      status: "unavailable",
      message: "monday identity confirmation persistence is not available yet.",
      identity: {
        mondayUserId: "monday-user-1",
        mondayAccountId: "monday-account-1",
        name: "Malik James-Williams",
        email: "malik@example.com",
        confidence: "high",
        confirmationRequired: false,
      },
    });

    const body = {
      mondayUserId: "monday-user-1",
      mondayAccountId: "monday-account-1",
      name: "Malik James-Williams",
      email: "malik@example.com",
    };
    const res = await POST(request(body));

    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({
      confirmation: {
        accepted: false,
        status: "unavailable",
        message: "monday identity confirmation persistence is not available yet.",
        identity: {
          mondayUserId: "monday-user-1",
          mondayAccountId: "monday-account-1",
          name: "Malik James-Williams",
          email: "malik@example.com",
          confidence: "high",
          confirmationRequired: false,
        },
      },
    });
    expect(mocks.confirmMondayIdentity).toHaveBeenCalledExactlyOnceWith({
      userId: "principal_123",
      payload: body,
    });
  });
});

function request(jsonBody: unknown): NextRequest {
  return {
    json: async () => jsonBody,
  } as unknown as NextRequest;
}
