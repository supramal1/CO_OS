import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

const mockSession = vi.fn();
vi.mock("@/auth", () => ({
  auth: () => mockSession(),
}));
vi.mock("@/lib/cornerstone", () => ({
  CORNERSTONE_URL: "https://cornerstone.test",
}));

import { POST } from "@/app/api/forge/briefs/[id]/promote/route";

type FetchMock = ReturnType<typeof vi.fn>;
let fetchMock: FetchMock;

function req({
  url = "https://co-os.test/api/forge/briefs/brief-1/promote?namespace=aiops",
  body = {},
}: {
  url?: string;
  body?: unknown;
} = {}): NextRequest {
  const text = JSON.stringify(body);
  return {
    nextUrl: new URL(url),
    headers: new Headers(),
    text: async () => text,
  } as unknown as NextRequest;
}

function okSession(isAdmin = true) {
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

const brief = {
  id: "brief-1",
  title: "Friday reporting bot",
  problem_statement: "Friday reports take 90 minutes and get lost.",
  frequency: "weekly",
  time_cost_minutes: 90,
  affected_scope: "team",
  desired_outcome: "Live dashboard, zero Friday work.",
  urgency: "high",
  submitter_id: "principal-1",
  status: "submitted",
  admin_notes: null,
  resolution: null,
  resulting_agent_id: null,
  resulting_task_ids: [],
  namespace: "aiops",
  created_at: "2026-04-28T10:00:00Z",
  updated_at: "2026-04-28T10:00:00Z",
};

beforeEach(() => {
  mockSession.mockReset();
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

describe("POST /api/forge/briefs/:id/promote", () => {
  it("creates a backlog task from a brief and links it back to the brief", async () => {
    okSession();
    queueFetch([
      { ok: true, status: 200, body: brief },
      {
        ok: true,
        status: 201,
        body: {
          id: "task-1",
          title: brief.title,
          lane: "backlog",
          status: "submitted",
          metadata: { source: "forge_brief", brief_id: brief.id },
        },
      },
      {
        ok: true,
        status: 200,
        body: {
          ...brief,
          status: "triaged",
          resulting_task_ids: ["task-1"],
        },
      },
    ]);

    const res = await POST(req(), { params: Promise.resolve({ id: "brief-1" }) });

    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      task: { id: string };
      brief: { resulting_task_ids: string[] };
    };
    expect(body.task.id).toBe("task-1");
    expect(body.brief.resulting_task_ids).toEqual(["task-1"]);

    const getBriefUrl = new URL(fetchMock.mock.calls[0][0] as string);
    expect(getBriefUrl.pathname).toBe("/forge/briefs/brief-1");
    expect(getBriefUrl.searchParams.get("namespace")).toBe("aiops");

    const createTaskUrl = new URL(fetchMock.mock.calls[1][0] as string);
    expect(createTaskUrl.pathname).toBe("/forge/tasks");
    expect(createTaskUrl.searchParams.get("namespace")).toBe("aiops");
    const taskPayload = JSON.parse(fetchMock.mock.calls[1][1].body as string);
    expect(taskPayload).toMatchObject({
      title: "Friday reporting bot",
      priority: 2,
      metadata: {
        source: "forge_brief",
        brief_id: "brief-1",
        frequency: "weekly",
        time_cost_minutes: 90,
        affected_scope: "team",
        desired_outcome: "Live dashboard, zero Friday work.",
        urgency: "high",
      },
    });
    expect(taskPayload.description).toContain(
      "Friday reports take 90 minutes and get lost.",
    );
    expect(taskPayload.description).toContain(
      "Live dashboard, zero Friday work.",
    );

    const patchPayload = JSON.parse(fetchMock.mock.calls[2][1].body as string);
    expect(patchPayload).toEqual({
      status: "triaged",
      resulting_task_ids: ["task-1"],
    });
  });

  it("does not create a duplicate task when the brief already has a linked task", async () => {
    okSession();
    queueFetch([
      {
        ok: true,
        status: 200,
        body: { ...brief, resulting_task_ids: ["existing-task"] },
      },
    ]);

    const res = await POST(req(), { params: Promise.resolve({ id: "brief-1" }) });

    expect(res.status).toBe(409);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = (await res.json()) as {
      error: string;
      task_ids: string[];
    };
    expect(body.error).toBe("brief_already_promoted");
    expect(body.task_ids).toEqual(["existing-task"]);
  });

  it("requires an admin session", async () => {
    okSession(false);

    const res = await POST(req(), { params: Promise.resolve({ id: "brief-1" }) });

    expect(res.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
