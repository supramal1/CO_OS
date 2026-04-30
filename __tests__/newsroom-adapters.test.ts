import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NewsroomAdapterContext } from "@/lib/newsroom/types";
import type { WorkbenchRunHistoryRow } from "@/lib/workbench/run-history";

const mocks = vi.hoisted(() => ({
  listWorkbenchRuns: vi.fn(),
}));

vi.mock("@/lib/workbench/run-history", () => ({
  listWorkbenchRuns: mocks.listWorkbenchRuns,
}));

vi.mock("@/lib/cornerstone", () => ({
  CORNERSTONE_URL: "https://cornerstone.test///",
}));

import {
  loadCornerstoneNewsroomSnapshot,
  loadReviewNewsroomSnapshot,
  loadWorkbenchNewsroomSnapshot,
} from "@/lib/newsroom/adapters";

const context: NewsroomAdapterContext = {
  userId: "principal_123",
  apiKey: "cornerstone-key",
  now: new Date("2026-04-30T09:00:00.000Z"),
  range: {
    from: new Date("2026-04-30T00:00:00.000Z"),
    to: new Date("2026-05-01T00:00:00.000Z"),
    since: new Date("2026-04-29T00:00:00.000Z"),
  },
};

const baseRun: WorkbenchRunHistoryRow = {
  id: "run_1",
  user_id: "principal_123",
  ask: "Help with Client Alpha follow-up",
  result: {
    decoded_task: {
      summary: "Client Alpha follow-up",
      requester: "Client Alpha",
      deliverable_type: "email",
      task_type: "ask_decode",
    },
    missing_context: [],
    drafted_clarifying_message: "",
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
    ask_chars: 35,
    status: "succeeded",
    error: null,
    created_at: "2026-04-29T12:00:01.000Z",
  },
  created_at: "2026-04-29T12:00:02.000Z",
};

beforeEach(() => {
  mocks.listWorkbenchRuns.mockReset();
  vi.unstubAllGlobals();
});

describe("newsroom adapters", () => {
  it("returns an explicit empty review snapshot", async () => {
    await expect(loadReviewNewsroomSnapshot(context)).resolves.toEqual({
      source: "review",
      status: { source: "review", status: "empty", itemsCount: 0 },
      candidates: [],
    });
  });

  it("maps recent Workbench runs and attention signals", async () => {
    mocks.listWorkbenchRuns.mockResolvedValue({
      status: "ok",
      runs: [
        {
          ...baseRun,
          result: {
            ...baseRun.result,
            missing_context: [{ question: "What is the deadline?", why: null }],
            warnings: ["Calendar returned partial context."],
          },
        },
        {
          ...baseRun,
          id: "run_old",
          created_at: "2026-04-28T23:59:59.000Z",
        },
      ],
    });

    const snapshot = await loadWorkbenchNewsroomSnapshot(context);

    expect(mocks.listWorkbenchRuns).toHaveBeenCalledWith({
      userId: "principal_123",
      limit: 20,
    });
    expect(snapshot.status).toEqual({ source: "workbench", status: "ok", itemsCount: 2 });
    expect(snapshot.candidates).toEqual([
      {
        id: "workbench-run-run_1",
        title: "Client Alpha follow-up",
        reason: "Workbench run started since yesterday.",
        source: "workbench",
        confidence: "medium",
        section: "changedSinceYesterday",
        href: "/workbench",
        action: { label: "Open Workbench", target: "workbench", href: "/workbench" },
        signals: ["changed_since_yesterday", "action_available"],
        sourceRefs: ["workbench:run_1"],
      },
      {
        id: "workbench-run-run_1-attention",
        title: "Client Alpha follow-up needs attention",
        reason: "What is the deadline? Calendar returned partial context.",
        source: "workbench",
        confidence: "medium",
        section: "needsAttention",
        href: "/workbench",
        action: { label: "Open Workbench", target: "workbench", href: "/workbench" },
        signals: ["missing_context", "missing_evidence", "action_available"],
        sourceRefs: ["workbench:run_1"],
      },
    ]);
  });

  it("returns Workbench unavailable and error snapshots from run history status", async () => {
    mocks.listWorkbenchRuns.mockResolvedValueOnce({
      status: "unavailable",
      runs: [],
      error: "workbench_run_history_unavailable",
    });

    await expect(loadWorkbenchNewsroomSnapshot(context)).resolves.toMatchObject({
      source: "workbench",
      status: {
        source: "workbench",
        status: "unavailable",
        reason: "workbench_run_history_unavailable",
        itemsCount: 0,
      },
      candidates: [],
    });

    mocks.listWorkbenchRuns.mockResolvedValueOnce({
      status: "error",
      runs: [],
      error: "workbench_run_history_failed",
      detail: "Supabase timeout",
    });

    await expect(loadWorkbenchNewsroomSnapshot(context)).resolves.toMatchObject({
      source: "workbench",
      status: {
        source: "workbench",
        status: "error",
        reason: "Supabase timeout",
        itemsCount: 0,
      },
      candidates: [],
    });
  });

  it("returns Cornerstone unavailable without an API key", async () => {
    await expect(
      loadCornerstoneNewsroomSnapshot({ ...context, apiKey: null }),
    ).resolves.toEqual({
      source: "cornerstone",
      status: {
        source: "cornerstone",
        status: "unavailable",
        reason: "Missing Cornerstone API key.",
        itemsCount: 0,
      },
      candidates: [],
    });
  });

  it("maps Cornerstone context text into an active context candidate", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({
        context: "Client Alpha needs final approval. Recent decisions are available.",
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(loadCornerstoneNewsroomSnapshot(context)).resolves.toEqual({
      source: "cornerstone",
      status: { source: "cornerstone", status: "ok", itemsCount: 1 },
      candidates: [
        {
          id: "cornerstone-active-context",
          title: "Active context is available",
          reason: "Client Alpha needs final approval.",
          source: "cornerstone",
          confidence: "medium",
          section: "today",
          signals: ["active_work"],
          sourceRefs: ["cornerstone:context"],
        },
      ],
    });
    expect(fetchMock).toHaveBeenCalledWith("https://cornerstone.test/context", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": "cornerstone-key",
      },
      body: JSON.stringify({
        query:
          "Newsroom daily orientation: active projects, clients, recent decisions, and judgement needs.",
        namespace: "default",
        detail_level: "minimal",
        max_tokens: 600,
      }),
    });
  });

  it("returns Cornerstone error when the context request is not ok", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("Nope", { status: 503 })),
    );

    await expect(loadCornerstoneNewsroomSnapshot(context)).resolves.toEqual({
      source: "cornerstone",
      status: {
        source: "cornerstone",
        status: "error",
        reason: "Cornerstone returned 503.",
        itemsCount: 0,
      },
      candidates: [],
    });
  });
});
