import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";
import type { WorkbenchArtifact } from "@/lib/workbench/make";
import type { WorkbenchPreflightResult } from "@/lib/workbench/types";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  anthropicCreate: vi.fn(),
}));

vi.mock("@/lib/server-auth", () => ({
  authWithApiKey: () => mocks.auth(),
}));

vi.mock("@anthropic-ai/sdk", () => ({
  default: class Anthropic {
    messages = {
      create: (...args: unknown[]) => mocks.anthropicCreate(...args),
    };
  },
}));

import { POST } from "@/app/api/workbench/review/route";

function req(jsonBody: unknown): NextRequest {
  return {
    json: async () => jsonBody,
  } as unknown as NextRequest;
}

describe("POST /api/workbench/review", () => {
  beforeEach(() => {
    mocks.auth.mockReset();
    mocks.anthropicCreate.mockReset();
    process.env.ANTHROPIC_API_KEY = "anthropic-test";
    process.env.ANTHROPIC_MODEL = "claude-sonnet-test";
  });

  it("authenticates staff and returns a quality-gate review", async () => {
    mocks.auth.mockResolvedValue({
      principalId: "principal_user_1",
      apiKey: "csk_test",
    });
    mocks.anthropicCreate.mockResolvedValue({
      content: [
        {
          type: "text",
          text: JSON.stringify({
            review: {
              senior_challenge: ["Add the reason for the revised timing."],
              assumptions: [],
              evidence_gaps: [],
              cookbook_check: ["Matches the concise client update pattern."],
              tone_check: [],
              manual_verification: [],
              overall_status: "approved_with_checks",
            },
          }),
        },
      ],
    });

    const res = await POST(
      req({
        ask: "Review this client email.",
        preflight_result: basePreflightResult(),
        artifact: baseArtifact(),
      }),
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      status: "reviewed",
      review: {
        senior_challenge: expect.any(Array),
        evidence_gaps: expect.any(Array),
        cookbook_check: expect.any(Array),
        overall_status: expect.stringMatching(
          /needs_revision|approved_with_checks|approved/,
        ),
      },
    });
    expect(mocks.anthropicCreate.mock.calls[0][0]).toMatchObject({
      model: "claude-sonnet-test",
      max_tokens: 1400,
      temperature: 0.1,
    });
  });

  it("rejects unauthenticated requests", async () => {
    mocks.auth.mockResolvedValue(null);

    const res = await POST(
      req({
        ask: "Review this client email.",
        preflight_result: basePreflightResult(),
        artifact: baseArtifact(),
      }),
    );

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthenticated" });
  });
});

function baseArtifact(): WorkbenchArtifact {
  return {
    type: "client_email",
    title: "Client delay update",
    body: "Hi Sam,\n\nThe plan will arrive on Friday with next steps.",
    assumptions: ["Friday timing is approved."],
    source_refs: [],
  };
}

function basePreflightResult(): WorkbenchPreflightResult {
  return {
    decoded_task: {
      summary: "Draft a client email to explain the delayed plan",
      requester: "Client lead",
      deliverable_type: "client email",
      task_type: "draft_check",
    },
    missing_context: [],
    drafted_clarifying_message: "",
    retrieved_context: [],
    suggested_approach: [],
    time_estimate: {
      estimated_before_minutes: 30,
      estimated_workbench_minutes: 10,
      task_type: "draft_check",
    },
    warnings: [],
  };
}
