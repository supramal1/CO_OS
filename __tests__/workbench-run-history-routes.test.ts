import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  listWorkbenchRuns: vi.fn(),
  getWorkbenchRun: vi.fn(),
}));

vi.mock("@/auth", () => ({
  auth: () => mocks.auth(),
}));

vi.mock("@/lib/workbench/run-history", () => ({
  listWorkbenchRuns: (...args: unknown[]) => mocks.listWorkbenchRuns(...args),
  getWorkbenchRun: (...args: unknown[]) => mocks.getWorkbenchRun(...args),
  normalizeWorkbenchRunLimit: (limit: number | undefined) => {
    if (!Number.isFinite(limit)) return 20;
    const rounded = Math.trunc(limit ?? 20);
    if (rounded < 1) return 20;
    return Math.min(rounded, 50);
  },
}));

import { GET as GET_RUN } from "@/app/api/workbench/runs/[id]/route";
import { GET as LIST_RUNS } from "@/app/api/workbench/runs/route";

const run = {
  id: "11111111-1111-4111-8111-111111111111",
  user_id: "principal_123",
  ask: "Help me reply to the client",
  result: {
    decoded_task: {
      summary: "Reply to the client",
      requester: "Client",
      deliverable_type: "email",
      task_type: "ask_decode",
    },
    missing_context: [],
    drafted_clarifying_message: "Can you confirm the deadline?",
    retrieved_context: [],
    suggested_approach: [],
    time_estimate: {
      estimated_before_minutes: 30,
      estimated_workbench_minutes: 10,
      task_type: "ask_decode",
    },
    warnings: [],
  },
  retrieval: {
    context: [],
    statuses: [],
    sources: [],
    warnings: [],
    generated_at: "2026-04-29T12:00:00.000Z",
  },
  invocation: {
    user_id: "principal_123",
    invocation_type: "preflight",
    task_type: "ask_decode",
    skill_name: "workbench-preflight",
    skill_version: "0.1.0",
    estimated_before_minutes: 30,
    observed_after_minutes: null,
    latency_ms: 500,
    ask_chars: 28,
    status: "succeeded",
    error: null,
    created_at: "2026-04-29T12:00:01.000Z",
  },
  created_at: "2026-04-29T12:00:02.000Z",
};

function request(url = "http://localhost/api/workbench/runs"): NextRequest {
  return {
    url,
    nextUrl: new URL(url),
  } as unknown as NextRequest;
}

beforeEach(() => {
  mocks.auth.mockReset();
  mocks.listWorkbenchRuns.mockReset();
  mocks.getWorkbenchRun.mockReset();
});

describe("GET /api/workbench/runs", () => {
  it("rejects unauthenticated requests", async () => {
    mocks.auth.mockResolvedValue(null);

    const res = await LIST_RUNS(request());

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthenticated" });
    expect(mocks.listWorkbenchRuns).not.toHaveBeenCalled();
  });

  it("lists recent runs for the authenticated principal", async () => {
    mocks.auth.mockResolvedValue({ principalId: "principal_123" });
    mocks.listWorkbenchRuns.mockResolvedValue({ status: "ok", runs: [run] });

    const res = await LIST_RUNS(
      request("http://localhost/api/workbench/runs?limit=5"),
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ runs: [run] });
    expect(mocks.listWorkbenchRuns).toHaveBeenCalledWith({
      userId: "principal_123",
      limit: 5,
    });
  });

  it("returns 503 when run history storage is unavailable", async () => {
    mocks.auth.mockResolvedValue({ principalId: "principal_123" });
    mocks.listWorkbenchRuns.mockResolvedValue({
      status: "unavailable",
      runs: [],
      error: "workbench_run_history_unavailable",
    });

    const res = await LIST_RUNS(request());

    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({
      error: "workbench_run_history_unavailable",
      runs: [],
    });
  });
});

describe("GET /api/workbench/runs/[id]", () => {
  it("rejects unauthenticated requests", async () => {
    mocks.auth.mockResolvedValue(null);

    const res = await GET_RUN(request(), {
      params: Promise.resolve({ id: run.id }),
    });

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthenticated" });
    expect(mocks.getWorkbenchRun).not.toHaveBeenCalled();
  });

  it("gets a single owned run by session principal", async () => {
    mocks.auth.mockResolvedValue({ principalId: "principal_123" });
    mocks.getWorkbenchRun.mockResolvedValue({ status: "ok", run });

    const res = await GET_RUN(request(), {
      params: Promise.resolve({ id: run.id }),
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ run });
    expect(mocks.getWorkbenchRun).toHaveBeenCalledWith({
      userId: "principal_123",
      id: run.id,
    });
  });

  it("does not expose another user's run", async () => {
    mocks.auth.mockResolvedValue({ principalId: "principal_123" });
    mocks.getWorkbenchRun.mockResolvedValue({ status: "ok", run: null });

    const res = await GET_RUN(request(), {
      params: Promise.resolve({ id: run.id }),
    });

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "workbench_run_not_found" });
    expect(mocks.getWorkbenchRun).toHaveBeenCalledWith({
      userId: "principal_123",
      id: run.id,
    });
  });
});
