import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  getSkill: vi.fn(),
  anthropicCreate: vi.fn(),
  gatherWorkbenchRetrieval: vi.fn(),
  persistWorkbenchInvocation: vi.fn(),
  persistWorkbenchRun: vi.fn(),
  processWorkbenchRunLearning: vi.fn(),
}));

vi.mock("@/auth", () => ({
  auth: () => mocks.auth(),
}));

vi.mock("server-only", () => ({}));

vi.mock("@/lib/cookbook-client", () => ({
  getSkill: (...args: unknown[]) => mocks.getSkill(...args),
  CookbookMcpError: class CookbookMcpError extends Error {
    status: number;
    constructor(message: string, status: number) {
      super(message);
      this.status = status;
    }
  },
}));

vi.mock("@/lib/workbench/persistence", () => ({
  persistWorkbenchInvocation: (...args: unknown[]) =>
    mocks.persistWorkbenchInvocation(...args),
}));

vi.mock("@/lib/workbench/run-history", () => ({
  persistWorkbenchRun: (...args: unknown[]) => mocks.persistWorkbenchRun(...args),
}));

vi.mock("@/lib/workbench/learning", () => ({
  processWorkbenchRunLearning: (...args: unknown[]) =>
    mocks.processWorkbenchRunLearning(...args),
}));

vi.mock("@/lib/workbench/retrieval", () => ({
  gatherWorkbenchRetrieval: (...args: unknown[]) =>
    mocks.gatherWorkbenchRetrieval(...args),
}));

vi.mock("@anthropic-ai/sdk", () => ({
  default: class Anthropic {
    messages = {
      create: (...args: unknown[]) => mocks.anthropicCreate(...args),
    };
  },
}));

import { POST } from "@/app/api/workbench/start/route";

function req(jsonBody: unknown): NextRequest {
  return {
    json: async () => jsonBody,
  } as unknown as NextRequest;
}

beforeEach(() => {
  mocks.auth.mockReset();
  mocks.getSkill.mockReset();
  mocks.anthropicCreate.mockReset();
  mocks.gatherWorkbenchRetrieval.mockReset();
  mocks.persistWorkbenchInvocation.mockReset();
  mocks.persistWorkbenchRun.mockReset();
  mocks.processWorkbenchRunLearning.mockReset();
  process.env.ANTHROPIC_API_KEY = "anthropic-test";
  process.env.ANTHROPIC_MODEL = "claude-sonnet-test";
  mocks.persistWorkbenchRun.mockResolvedValue({
    status: "unavailable",
    error: "workbench_run_history_unavailable",
  });
  mocks.gatherWorkbenchRetrieval.mockResolvedValue({
    sources: [],
    context: [],
    warnings: [],
    generated_at: "2026-04-29T12:00:00.000Z",
  });
});

describe("POST /api/workbench/start", () => {
  it("loads workbench-preflight, calls Anthropic server-side, and logs by session user", async () => {
    mocks.auth.mockResolvedValue({
      apiKey: "csk_test",
      principalId: "principal_user_1",
    });
    mocks.getSkill.mockResolvedValue({
      name: "workbench-preflight",
      version: "0.1.0",
      content: "PRE-FLIGHT SYSTEM PROMPT",
    });
    mocks.anthropicCreate.mockResolvedValue({
      content: [
        {
          type: "text",
          text: JSON.stringify({
            decoded_task: {
              summary: "Respond to an EM ask",
              requester: "EM",
              deliverable_type: "written_response",
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
          }),
        },
      ],
    });

    const res = await POST(req({ ask: "Help me respond to this EM ask" }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      result: { decoded_task: { summary: string } };
      invocation: { user_id: string; skill_version: string };
      workflow: unknown;
    };

    expect(body.result.decoded_task.summary).toBe("Respond to an EM ask");
    expect(body.workflow).toMatchObject({
      current_stage: "understand",
      stages: [
        {
          id: "understand",
          label: "Understand",
          status: "complete",
        },
        {
          id: "gather",
          label: "Gather",
          status: "complete",
        },
        {
          id: "make",
          label: "Make",
          status: "available",
        },
        {
          id: "review",
          label: "Review",
          status: "locked",
        },
        {
          id: "save",
          label: "Save",
          status: "locked",
        },
      ],
    });
    expect(body.invocation).toMatchObject({
      user_id: "principal_user_1",
      skill_version: "0.1.0",
    });
    expect(mocks.getSkill).toHaveBeenCalledWith("csk_test", "workbench-preflight");
    expect(mocks.anthropicCreate.mock.calls[0][0].system).toContain(
      "PRE-FLIGHT SYSTEM PROMPT",
    );
    expect(mocks.persistWorkbenchInvocation.mock.calls[0][0]).toMatchObject({
      user_id: "principal_user_1",
      invocation_type: "preflight",
      task_type: "ask_decode",
      skill_version: "0.1.0",
    });
  });

  it("runs profile learning after a successful stored run", async () => {
    mocks.auth.mockResolvedValue({
      apiKey: "csk_test",
      principalId: "principal_user_1",
    });
    mocks.getSkill.mockResolvedValue({
      name: "workbench-preflight",
      version: "0.1.0",
      content: "PRE-FLIGHT SYSTEM PROMPT",
    });
    mocks.persistWorkbenchRun.mockResolvedValue({
      status: "stored",
      run: {
        id: "run-1",
        created_at: "2026-04-30T10:00:00.000Z",
      },
    });
    mocks.processWorkbenchRunLearning.mockResolvedValue({
      status: "updated",
      targetLabel: "Voice",
      canUndo: true,
      updateId: "update-1",
    });
    mocks.anthropicCreate.mockResolvedValue({
      content: [
        {
          type: "text",
          text: JSON.stringify({
            decoded_task: {
              summary: "Respond to an EM ask",
              requester: "EM",
              deliverable_type: "written_response",
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
          }),
        },
      ],
    });

    const res = await POST(req({ ask: "I prefer direct bullets." }));

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      run_history: {
        status: "stored",
        id: "run-1",
      },
      profile_update: {
        status: "updated",
        targetLabel: "Voice",
        canUndo: true,
        updateId: "update-1",
      },
    });
    expect(mocks.processWorkbenchRunLearning).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "principal_user_1",
        ask: "I prefer direct bullets.",
        sourceRunId: "run-1",
      }),
    );
  });

  it("includes retrieved context blocks in the pre-flight Anthropic call", async () => {
    mocks.auth.mockResolvedValue({
      apiKey: "csk_test",
      principalId: "principal_user_1",
    });
    mocks.getSkill.mockResolvedValue({
      name: "workbench-preflight",
      version: "0.1.0",
      content: "PRE-FLIGHT SYSTEM PROMPT",
    });
    mocks.gatherWorkbenchRetrieval.mockResolvedValue({
      sources: [
        {
          source: "calendar",
          status: "available",
          items: [
            {
              claim: "Calendar event: Nike QBR prep, 2026-05-02T10:00:00.000Z",
              source_type: "calendar",
              source_label: "Nike QBR prep",
              source_url: "https://calendar.google.com/event?eid=event-1",
            },
          ],
          warnings: [],
        },
        {
          source: "notion",
          status: "unavailable",
          items: [],
          warnings: ["Missing Notion config."],
        },
      ],
      context: [
        {
          claim: "Calendar event: Nike QBR prep, 2026-05-02T10:00:00.000Z",
          source_type: "calendar",
          source_label: "Nike QBR prep",
          source_url: "https://calendar.google.com/event?eid=event-1",
        },
      ],
      warnings: ["Missing Notion config."],
      generated_at: "2026-04-29T12:00:00.000Z",
    });
    mocks.anthropicCreate.mockResolvedValue({
      content: [
        {
          type: "text",
          text: JSON.stringify({
            decoded_task: {
              summary: "Respond to an EM ask",
              requester: "EM",
              deliverable_type: "written_response",
              task_type: "ask_decode",
            },
            missing_context: [],
            drafted_clarifying_message: "Can you confirm the deadline?",
            retrieved_context: [
              {
                claim: "Calendar event: Nike QBR prep, 2026-05-02T10:00:00.000Z",
                source_type: "calendar",
                source_label: "Nike QBR prep",
                source_url: "https://calendar.google.com/event?eid=event-1",
              },
            ],
            suggested_approach: [],
            time_estimate: {
              estimated_before_minutes: 30,
              estimated_workbench_minutes: 10,
              task_type: "ask_decode",
            },
            warnings: [],
          }),
        },
      ],
    });

    const res = await POST(req({ ask: "Help me respond to this EM ask" }));

    expect(res.status).toBe(200);
    const anthropicInput = mocks.anthropicCreate.mock.calls[0][0];
    expect(anthropicInput.messages[0].content).toContain("Nike QBR prep");
    expect(anthropicInput.messages[0].content).toContain(
      "https://calendar.google.com/event?eid=event-1",
    );
    expect(anthropicInput.messages[0].content).toContain("notion: unavailable");
    expect(anthropicInput.messages[0].content).toContain("Missing Notion config.");
    const body = (await res.json()) as { retrieval: { sources: unknown[] } };
    expect(body.retrieval.sources).toHaveLength(2);
    expect(mocks.gatherWorkbenchRetrieval).toHaveBeenCalledWith(
      expect.objectContaining({
        ask: "Help me respond to this EM ask",
        userId: "principal_user_1",
        apiKey: "csk_test",
      }),
    );
  });

  it("rejects unauthenticated requests", async () => {
    mocks.auth.mockResolvedValue(null);

    const res = await POST(req({ ask: "Hello" }));

    expect(res.status).toBe(401);
  });

  it("returns an actionable Anthropic auth error when the API key is rejected", async () => {
    mocks.auth.mockResolvedValue({
      apiKey: "csk_test",
      principalId: "principal_user_1",
    });
    mocks.getSkill.mockResolvedValue({
      name: "workbench-preflight",
      version: "0.1.0",
      content: "PRE-FLIGHT SYSTEM PROMPT",
    });
    const error = new Error(
      '401 {"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"}}',
    ) as Error & { status: number };
    error.status = 401;
    mocks.anthropicCreate.mockRejectedValue(error);

    const res = await POST(req({ ask: "Help me respond to this ask" }));

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({
      error: "anthropic_api_key_rejected",
      detail:
        "Anthropic rejected ANTHROPIC_API_KEY. Update the local key and restart the dev server.",
    });
  });
});
