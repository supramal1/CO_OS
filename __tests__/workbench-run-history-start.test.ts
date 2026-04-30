import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  loadWorkbenchSkill: vi.fn(),
  anthropicCreate: vi.fn(),
  gatherWorkbenchRetrieval: vi.fn(),
  persistWorkbenchInvocation: vi.fn(),
  persistWorkbenchRun: vi.fn(),
}));

vi.mock("server-only", () => ({}));

vi.mock("@/lib/workbench/skill-loader", () => ({
  loadWorkbenchSkill: (...args: unknown[]) => mocks.loadWorkbenchSkill(...args),
}));

vi.mock("@/lib/workbench/retrieval", () => ({
  gatherWorkbenchRetrieval: (...args: unknown[]) =>
    mocks.gatherWorkbenchRetrieval(...args),
}));

vi.mock("@/lib/workbench/persistence", () => ({
  persistWorkbenchInvocation: (...args: unknown[]) =>
    mocks.persistWorkbenchInvocation(...args),
}));

vi.mock("@/lib/workbench/run-history", () => ({
  persistWorkbenchRun: (...args: unknown[]) => mocks.persistWorkbenchRun(...args),
}));

vi.mock("@anthropic-ai/sdk", () => ({
  default: class Anthropic {
    messages = {
      create: (...args: unknown[]) => mocks.anthropicCreate(...args),
    };
  },
}));

import { runWorkbenchStart } from "@/lib/workbench/start";

const preflightJson = {
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
};

const retrieval = {
  context: [],
  statuses: [
    {
      source: "calendar",
      status: "unavailable",
      reason: "google_calendar_access_token_missing",
      items_count: 0,
    },
  ],
  sources: [
    {
      source: "calendar",
      status: "unavailable",
      items: [],
      warnings: ["google_calendar_access_token_missing"],
    },
  ],
  warnings: ["google_calendar_access_token_missing"],
  generated_at: "2026-04-29T12:00:00.000Z",
};

beforeEach(() => {
  mocks.loadWorkbenchSkill.mockReset();
  mocks.anthropicCreate.mockReset();
  mocks.gatherWorkbenchRetrieval.mockReset();
  mocks.persistWorkbenchInvocation.mockReset();
  mocks.persistWorkbenchRun.mockReset();

  mocks.loadWorkbenchSkill.mockResolvedValue({
    name: "workbench-preflight",
    version: "0.1.0",
    content: "PRE-FLIGHT SYSTEM PROMPT",
  });
  mocks.gatherWorkbenchRetrieval.mockResolvedValue(retrieval);
  mocks.anthropicCreate.mockResolvedValue({
    content: [{ type: "text", text: JSON.stringify(preflightJson) }],
  });
  mocks.persistWorkbenchInvocation.mockResolvedValue(undefined);
  mocks.persistWorkbenchRun.mockResolvedValue({
    status: "stored",
    run: {
      id: "11111111-1111-4111-8111-111111111111",
      user_id: "principal_123",
      ask: "Help me reply to the client",
      result: preflightJson,
      retrieval,
      invocation: {},
      created_at: "2026-04-29T12:00:02.000Z",
    },
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("runWorkbenchStart run history persistence", () => {
  it("persists run history after invocation persistence", async () => {
    const events: string[] = [];
    mocks.persistWorkbenchInvocation.mockImplementation(async () => {
      events.push("invocation");
    });
    mocks.persistWorkbenchRun.mockImplementation(async () => {
      events.push("history");
      return {
        status: "stored",
        run: {
          id: "11111111-1111-4111-8111-111111111111",
          created_at: "2026-04-29T12:00:02.000Z",
        },
      };
    });

    const response = await runWorkbenchStart({
      ask: "Help me reply to the client",
      userId: "principal_123",
      apiKey: "csk_test",
      anthropicApiKey: "anthropic-test",
    });

    expect(events).toEqual(["invocation", "history"]);
    expect(mocks.persistWorkbenchRun).toHaveBeenCalledWith({
      userId: "principal_123",
      ask: "Help me reply to the client",
      result: response.result,
      retrieval: response.retrieval,
      invocation: response.invocation,
    });
    expect(response.run_history).toEqual({
      status: "stored",
      id: "11111111-1111-4111-8111-111111111111",
      created_at: "2026-04-29T12:00:02.000Z",
    });
  });

  it("does not block the start response when run history persistence fails", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    mocks.persistWorkbenchRun.mockRejectedValue(new Error("history db down"));

    const response = await runWorkbenchStart({
      ask: "Help me reply to the client",
      userId: "principal_123",
      apiKey: "csk_test",
      anthropicApiKey: "anthropic-test",
    });

    expect(response.result.decoded_task.summary).toBe("Reply to the client");
    expect(response.invocation.user_id).toBe("principal_123");
    expect(response.run_history).toEqual({
      status: "error",
      reason: "workbench_run_history_failed",
      detail: "history db down",
    });
    expect(warn).toHaveBeenCalledWith(
      "[workbench] run history persistence failed:",
      "history db down",
    );
  });
});
