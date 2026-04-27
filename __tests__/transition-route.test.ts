import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";

// Mock next-auth before importing the route — the route reads
// getServerSession at top of handler.
const mockSession = vi.fn();
vi.mock("next-auth", () => ({
  getServerSession: () => mockSession(),
}));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/cornerstone", () => ({
  CORNERSTONE_URL: "https://cornerstone.test",
}));

// Import AFTER mocks are registered.
import { POST } from "@/app/api/forge/tasks/[id]/transition/route";

type FetchMock = ReturnType<typeof vi.fn>;
let fetchMock: FetchMock;

function req(body: unknown): NextRequest {
  const text = JSON.stringify(body);
  return {
    nextUrl: new URL("https://co-os.test/api/forge/tasks/t1/transition"),
    headers: new Headers(),
    text: async () => text,
    json: async () => body,
  } as unknown as NextRequest;
}

function okSession(isAdmin: boolean) {
  mockSession.mockResolvedValue({
    apiKey: "test-key",
    isAdmin,
  });
}

function queueFetch(responses: Array<{ ok: boolean; status: number; body: unknown }>) {
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

describe("POST /api/forge/tasks/:id/transition — auth gates", () => {
  it("returns 401 when unauthenticated", async () => {
    mockSession.mockResolvedValue(null);
    const res = await POST(
      req({ from_lane: "backlog", to_lane: "research" }),
      { params: { id: "t1" } },
    );
    expect(res.status).toBe(401);
  });

  it("returns 403 when authenticated but not admin", async () => {
    okSession(false);
    const res = await POST(
      req({ from_lane: "backlog", to_lane: "research" }),
      { params: { id: "t1" } },
    );
    expect(res.status).toBe(403);
  });
});

describe("POST /api/forge/tasks/:id/transition — input validation", () => {
  it("rejects invalid lane values with 400", async () => {
    okSession(true);
    const res = await POST(
      req({ from_lane: "nonsense", to_lane: "research" }),
      { params: { id: "t1" } },
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("bad_request");
  });

  it("rejects a non-human-gated transition with 400", async () => {
    okSession(true);
    const res = await POST(
      req({ from_lane: "research", to_lane: "research_review" }),
      { params: { id: "t1" } },
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("transition_not_allowed");
  });
});

describe("POST /api/forge/tasks/:id/transition — lane drift detection", () => {
  it("returns 409 when task lane no longer matches client's from_lane", async () => {
    okSession(true);
    queueFetch([
      {
        ok: true,
        status: 200,
        // Server says lane is already 'research' — a Realtime event
        // probably moved it after the client rendered.
        body: {
          id: "t1",
          title: "X",
          description: null,
          lane: "research",
          status: "submitted",
          priority: 0,
          metadata: {},
        },
      },
    ]);
    const res = await POST(
      req({ from_lane: "backlog", to_lane: "research" }),
      { params: { id: "t1" } },
    );
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("lane_out_of_sync");
  });
});

describe("POST /api/forge/tasks/:id/transition — invoke path (backlog→research)", () => {
  it("POSTs /invoke with task_id + brief on happy path", async () => {
    okSession(true);
    queueFetch([
      {
        ok: true,
        status: 200,
        body: {
          id: "t1",
          title: "Decompose a brief",
          description: "Make it a thing",
          lane: "backlog",
          status: "submitted",
          priority: 1,
          metadata: { foo: "bar" },
        },
      },
      { ok: true, status: 200, body: { queued: true } },
    ]);
    const res = await POST(
      req({ from_lane: "backlog", to_lane: "research" }),
      { params: { id: "t1" } },
    );
    expect(res.status).toBe(200);

    // Second fetch is the one to /invoke — inspect its args.
    const invokeCall = fetchMock.mock.calls[1];
    expect(invokeCall[0]).toMatch(/\/invoke$/);
    const sent = JSON.parse(invokeCall[1].body as string);
    expect(sent).toEqual({
      task_id: "t1",
      brief: {
        title: "Decompose a brief",
        description: "Make it a thing",
        metadata: { foo: "bar" },
        priority: 1,
      },
    });
  });
});

describe("POST /api/forge/tasks/:id/transition — resume path (research_review→production)", () => {
  it("finds the paused pm_orchestration run and POSTs /resume with its session_id", async () => {
    okSession(true);
    queueFetch([
      // GET task
      {
        ok: true,
        status: 200,
        body: {
          id: "t1",
          title: "X",
          description: null,
          lane: "research_review",
          status: "scoping",
          priority: 0,
          metadata: {},
        },
      },
      // GET runs — includes an unrelated run first to prove the filter works
      {
        ok: true,
        status: 200,
        body: [
          {
            id: "r-old",
            task_id: "t1",
            run_type: "research",
            stage: "completed",
            session_id: "should-not-pick",
            created_at: "2026-04-01T00:00:00Z",
          },
          {
            id: "r-paused",
            task_id: "t1",
            run_type: "pm_orchestration",
            stage: "awaiting_review",
            session_id: "pm-session-xyz",
            created_at: "2026-04-23T00:00:00Z",
          },
        ],
      },
      // POST /resume
      { ok: true, status: 200, body: { resumed: true } },
    ]);
    const res = await POST(
      req({ from_lane: "research_review", to_lane: "production" }),
      { params: { id: "t1" } },
    );
    expect(res.status).toBe(200);

    const resumeCall = fetchMock.mock.calls[2];
    expect(resumeCall[0]).toMatch(/\/resume$/);
    const sent = JSON.parse(resumeCall[1].body as string);
    expect(sent).toEqual({
      session_id: "pm-session-xyz",
      decision: "approved",
      notes: "",
    });
  });

  it("returns 409 when no paused pm_orchestration run exists", async () => {
    okSession(true);
    queueFetch([
      {
        ok: true,
        status: 200,
        body: {
          id: "t1",
          title: "X",
          description: null,
          lane: "research_review",
          status: "scoping",
          priority: 0,
          metadata: {},
        },
      },
      { ok: true, status: 200, body: [] },
    ]);
    const res = await POST(
      req({ from_lane: "research_review", to_lane: "production" }),
      { params: { id: "t1" } },
    );
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("no_paused_run");
  });
});
