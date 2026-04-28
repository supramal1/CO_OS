import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";
import type { ForgeTask } from "@/lib/agents-types";

const mockSession = vi.fn();
vi.mock("next-auth", () => ({
  getServerSession: () => mockSession(),
}));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/cornerstone", () => ({
  CORNERSTONE_URL: "https://cornerstone.test",
}));

import { POST } from "@/app/api/forge/tasks/[id]/cancel/route";

type FetchMock = ReturnType<typeof vi.fn>;
let fetchMock: FetchMock;

function req(): NextRequest {
  return {
    nextUrl: new URL(
      "https://co-os.test/api/forge/tasks/t1/cancel?namespace=aiops",
    ),
    headers: new Headers(),
  } as unknown as NextRequest;
}

function task(overrides: Partial<ForgeTask> = {}): ForgeTask {
  return {
    id: "t1",
    title: "Cancel me",
    description: null,
    lane: "research",
    status: "running",
    agent_id: null,
    priority: 0,
    creator_type: null,
    creator_id: null,
    assignee_type: null,
    assignee_id: null,
    metadata: null,
    namespace: "aiops",
    created_at: "2026-04-28T09:00:00.000Z",
    updated_at: "2026-04-28T09:10:00.000Z",
    ...overrides,
  };
}

function okSession(isAdmin: boolean) {
  mockSession.mockResolvedValue({
    apiKey: "test-key",
    isAdmin,
  });
}

function queueFetch(
  responses: Array<{ ok: boolean; status: number; body: unknown }>,
) {
  fetchMock.mockImplementation(() => {
    const next = responses.shift();
    if (!next) throw new Error("Unexpected extra fetch call");
    return Promise.resolve({
      ok: next.ok,
      status: next.status,
      text: async () =>
        typeof next.body === "string" ? next.body : JSON.stringify(next.body),
      json: async () => next.body,
    } as Response);
  });
}

beforeEach(() => {
  mockSession.mockReset();
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

describe("POST /api/forge/tasks/:id/cancel — auth gates", () => {
  it("returns 401 when unauthenticated", async () => {
    mockSession.mockResolvedValue(null);
    const res = await POST(req(), { params: Promise.resolve({ id: "t1" }) });
    expect(res.status).toBe(401);
  });

  it("returns 403 when authenticated but not admin", async () => {
    okSession(false);
    const res = await POST(req(), { params: Promise.resolve({ id: "t1" }) });
    expect(res.status).toBe(403);
  });
});

describe("POST /api/forge/tasks/:id/cancel", () => {
  it("rejects non-running tasks", async () => {
    okSession(true);
    queueFetch([
      {
        ok: true,
        status: 200,
        body: task({ lane: "done", status: "completed" }),
      },
    ]);

    const res = await POST(req(), { params: Promise.resolve({ id: "t1" }) });

    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("task_not_cancellable");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("PATCHes the Forge task to cancelled/done", async () => {
    okSession(true);
    const cancelled = task({
      lane: "done",
      status: "cancelled",
      updated_at: "2026-04-28T10:00:00.000Z",
    });
    queueFetch([
      { ok: true, status: 200, body: task() },
      { ok: true, status: 200, body: cancelled },
    ]);

    const res = await POST(req(), { params: Promise.resolve({ id: "t1" }) });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(cancelled);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://cornerstone.test/forge/tasks/t1?namespace=aiops",
    );
    expect(fetchMock.mock.calls[1][0]).toBe(
      "https://cornerstone.test/forge/tasks/t1?namespace=aiops",
    );
    expect(fetchMock.mock.calls[1][1]).toMatchObject({
      method: "PATCH",
      body: JSON.stringify({ status: "cancelled", lane: "done" }),
    });
  });

  it("passes through Cornerstone PATCH failures", async () => {
    okSession(true);
    queueFetch([
      { ok: true, status: 200, body: task() },
      { ok: false, status: 500, body: { error: "write_failed" } },
    ]);

    const res = await POST(req(), { params: Promise.resolve({ id: "t1" }) });

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "write_failed" });
  });
});
