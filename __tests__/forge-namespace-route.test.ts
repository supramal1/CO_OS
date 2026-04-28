import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

const mockSession = vi.fn();
vi.mock("@/auth", () => ({
  auth: () => mockSession(),
}));
vi.mock("@/lib/cornerstone", () => ({
  CORNERSTONE_URL: "https://cornerstone.test",
}));

import {
  GET as listTasks,
  POST as createTask,
} from "@/app/api/forge/tasks/route";
import { PATCH as updateTask } from "@/app/api/forge/tasks/[id]/route";
import { POST as transitionTask } from "@/app/api/forge/tasks/[id]/transition/route";

type FetchMock = ReturnType<typeof vi.fn>;
let fetchMock: FetchMock;

function req({
  url = "https://co-os.test/api/forge/tasks",
  method = "GET",
  headers,
  body,
  jsonBody,
}: {
  url?: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  jsonBody?: unknown;
} = {}): NextRequest {
  const nextUrl = new URL(url);
  const h = new Headers(headers);
  const text = body ?? (jsonBody === undefined ? "" : JSON.stringify(jsonBody));
  return {
    method,
    nextUrl,
    headers: h,
    text: async () => text,
    json: async () => (jsonBody === undefined ? JSON.parse(text || "{}") : jsonBody),
  } as unknown as NextRequest;
}

function okSession() {
  mockSession.mockResolvedValue({
    apiKey: "test-key",
    isAdmin: true,
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
  okSession();
});

describe("Forge task route namespace scoping", () => {
  it("forwards query namespace when listing tasks for a multi-workspace admin", async () => {
    queueFetch([{ ok: true, status: 200, body: [] }]);

    const res = await listTasks(
      req({
        url: "https://co-os.test/api/forge/tasks?namespace=aiops&limit=50",
      }),
    );

    expect(res?.status).toBe(200);
    const upstream = new URL(fetchMock.mock.calls[0][0] as string);
    expect(upstream.searchParams.get("namespace")).toBe("aiops");
    expect(upstream.searchParams.get("limit")).toBe("50");
  });

  it("forwards header namespace when creating a task", async () => {
    queueFetch([{ ok: true, status: 201, body: { id: "t1" } }]);

    const res = await createTask(
      req({
        method: "POST",
        headers: { "x-cornerstone-namespace": "paid-media" },
        body: JSON.stringify({ title: "Workspace-local task" }),
      }),
    );

    expect(res.status).toBe(201);
    const upstream = new URL(fetchMock.mock.calls[0][0] as string);
    expect(upstream.searchParams.get("namespace")).toBe("paid-media");
  });

  it("forwards body namespace when updating a task", async () => {
    queueFetch([{ ok: true, status: 200, body: { id: "t1" } }]);

    const res = await updateTask(
      req({
        method: "PATCH",
        body: JSON.stringify({
          namespace: "finance",
          title: "Finance-only task",
        }),
      }),
      { params: Promise.resolve({ id: "t1" }) },
    );

    expect(res?.status).toBe(200);
    const upstream = new URL(fetchMock.mock.calls[0][0] as string);
    expect(upstream.searchParams.get("namespace")).toBe("finance");
  });

  it("keeps transition task and run lookups inside the selected namespace", async () => {
    queueFetch([
      {
        ok: true,
        status: 200,
        body: {
          id: "t1",
          title: "Scoped task",
          description: null,
          lane: "research_review",
          status: "scoping",
          priority: 0,
          metadata: {},
        },
      },
      {
        ok: true,
        status: 200,
        body: [
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
      { ok: true, status: 200, body: { resumed: true } },
    ]);

    const res = await transitionTask(
      req({
        method: "POST",
        url: "https://co-os.test/api/forge/tasks/t1/transition?namespace=aiops",
        jsonBody: {
          from_lane: "research_review",
          to_lane: "production",
        },
      }),
      { params: Promise.resolve({ id: "t1" }) },
    );

    expect(res.status).toBe(200);
    const taskLookup = new URL(fetchMock.mock.calls[0][0] as string);
    const runsLookup = new URL(fetchMock.mock.calls[1][0] as string);
    expect(taskLookup.searchParams.get("namespace")).toBe("aiops");
    expect(runsLookup.searchParams.get("namespace")).toBe("aiops");
  });
});
