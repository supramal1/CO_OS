import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  getSkill: vi.fn(),
  anthropicCreate: vi.fn(),
  persistWorkbenchInvocation: vi.fn(),
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

vi.mock("@anthropic-ai/sdk", () => ({
  default: class Anthropic {
    messages = {
      create: (...args: unknown[]) => mocks.anthropicCreate(...args),
    };
  },
}));

import { POST } from "@/app/api/workbench/presend/route";

function req(jsonBody: unknown): NextRequest {
  return {
    json: async () => jsonBody,
  } as unknown as NextRequest;
}

const preflightResult = {
  decoded_task: {
    summary: "Prepare a client-ready follow-up note",
    requester: "EM",
    deliverable_type: "written_response",
    task_type: "draft_check",
  },
  missing_context: [],
  drafted_clarifying_message: "",
  retrieved_context: [],
  suggested_approach: [],
  time_estimate: {
    estimated_before_minutes: 35,
    estimated_workbench_minutes: 12,
    task_type: "draft_check",
  },
  warnings: [],
};

beforeEach(() => {
  mocks.auth.mockReset();
  mocks.getSkill.mockReset();
  mocks.anthropicCreate.mockReset();
  mocks.persistWorkbenchInvocation.mockReset();
  process.env.ANTHROPIC_API_KEY = "anthropic-test";
  process.env.ANTHROPIC_MODEL = "claude-sonnet-test";
});

describe("POST /api/workbench/presend", () => {
  it("loads workbench-presend, calls Anthropic server-side, and logs by session user", async () => {
    mocks.auth.mockResolvedValue({
      apiKey: "csk_test",
      principalId: "principal_user_1",
    });
    mocks.getSkill.mockResolvedValue({
      name: "workbench-presend",
      version: "0.1.0",
      content: "PRESEND SYSTEM PROMPT",
    });
    mocks.anthropicCreate.mockResolvedValue({
      content: [
        {
          type: "text",
          text: JSON.stringify({
            artifact_intent: {
              artifact_type: "notion_update",
              title: "Client follow-up note",
              audience: "Client team",
              purpose: "Confirm decisions and next steps",
            },
            artifact_spec: {
              format: "notion_page",
              sections: [
                {
                  heading: "Decisions",
                  purpose: "Capture what was agreed",
                },
              ],
              source_context: [],
            },
            quality_checks: [
              {
                check: "No unsupported claims",
                status: "pass",
                detail: null,
              },
            ],
            save_back_requirements: [
              {
                target: "notion",
                action: "update_page",
                required: true,
                reason: "Capture the follow-up in Notion",
              },
            ],
            warnings: [],
          }),
        },
      ],
    });

    const res = await POST(
      req({
        preflight_result: preflightResult,
        draft_input: "Draft: Thanks for the time today.",
        artifact_spec_input: "Need a Notion-ready client follow-up note.",
      }),
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      result: { artifact_intent: { title: string } };
      invocation: {
        user_id: string;
        invocation_type: string;
        skill_version: string;
      };
    };

    expect(body.result.artifact_intent.title).toBe("Client follow-up note");
    expect(body.invocation).toMatchObject({
      user_id: "principal_user_1",
      invocation_type: "presend",
      skill_version: "0.1.0",
    });
    expect(mocks.getSkill).toHaveBeenCalledWith("csk_test", "workbench-presend");
    expect(mocks.anthropicCreate.mock.calls[0][0].system).toContain(
      "PRESEND SYSTEM PROMPT",
    );
    expect(mocks.anthropicCreate.mock.calls[0][0].system).toContain(
      "Do not use em dashes",
    );
    expect(mocks.anthropicCreate.mock.calls[0][0].messages[0].content).toContain(
      "Draft: Thanks for the time today.",
    );
    expect(mocks.persistWorkbenchInvocation.mock.calls[0][0]).toMatchObject({
      user_id: "principal_user_1",
      invocation_type: "presend",
      task_type: "draft_check",
      skill_version: "0.1.0",
    });
  });

  it("rejects missing preflight result or draft/spec input", async () => {
    mocks.auth.mockResolvedValue({
      apiKey: "csk_test",
      principalId: "principal_user_1",
    });

    const res = await POST(req({ draft_input: "Draft only" }));

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: "missing_presend_input",
      required: ["preflight_result", "draft_input or artifact_spec_input"],
    });
  });

  it("rejects unauthenticated requests", async () => {
    mocks.auth.mockResolvedValue(null);

    const res = await POST(
      req({
        preflight_result: preflightResult,
        draft_input: "Draft",
      }),
    );

    expect(res.status).toBe(401);
  });
});
