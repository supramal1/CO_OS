import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";
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

import { POST } from "@/app/api/workbench/make/route";

function req(jsonBody: unknown): NextRequest {
  return {
    json: async () => jsonBody,
  } as unknown as NextRequest;
}

describe("POST /api/workbench/make", () => {
  beforeEach(() => {
    mocks.auth.mockReset();
    mocks.anthropicCreate.mockReset();
    process.env.ANTHROPIC_API_KEY = "anthropic-test";
    process.env.ANTHROPIC_MODEL = "claude-sonnet-test";
  });

  it("authenticates staff and returns a drafted artefact", async () => {
    mocks.auth.mockResolvedValue({
      principalId: "principal_user_1",
      apiKey: "csk_test",
    });
    mocks.anthropicCreate.mockResolvedValue({
      content: [
        {
          type: "text",
          text: JSON.stringify({
            artifact: {
              type: "client_email",
              title: "Client follow-up",
              body: "Hi Sam,\n\nWe will send the updated plan by Friday.",
              assumptions: ["Friday timing is approved."],
              source_refs: [],
            },
          }),
        },
      ],
    });

    const res = await POST(
      req({
        ask: "Draft the client follow-up.",
        preflight_result: basePreflightResult(),
        retrieved_context: [],
      }),
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      status: "drafted",
      artifact: {
        type: "client_email",
        title: "Client follow-up",
      },
    });
    expect(mocks.anthropicCreate.mock.calls[0][0]).toMatchObject({
      model: "claude-sonnet-test",
      max_tokens: 1800,
      temperature: 0.2,
    });
  });

  it("uses the shared Workbench default model when no model env is set", async () => {
    mocks.auth.mockResolvedValue({
      principalId: "principal_user_1",
      apiKey: "csk_test",
    });
    delete process.env.ANTHROPIC_MODEL;
    mocks.anthropicCreate.mockResolvedValue({
      content: [
        {
          type: "text",
          text: JSON.stringify({
            artifact: {
              type: "client_email",
              title: "Client follow-up",
              body: "Hi Sam,\n\nWe will send the updated plan by Friday.",
              assumptions: [],
              source_refs: [],
            },
          }),
        },
      ],
    });

    const res = await POST(
      req({
        ask: "Draft the client follow-up.",
        preflight_result: basePreflightResult(),
        retrieved_context: [],
      }),
    );

    expect(res.status).toBe(200);
    expect(mocks.anthropicCreate.mock.calls[0][0]).toMatchObject({
      model: "claude-sonnet-4-6",
    });
  });

  it("returns a deterministic draft when the provider fails after auth", async () => {
    mocks.auth.mockResolvedValue({
      principalId: "principal_user_1",
      apiKey: "csk_test",
    });
    mocks.anthropicCreate.mockRejectedValue(new Error("model_not_found"));

    const res = await POST(
      req({
        ask: "Draft the client follow-up.",
        preflight_result: basePreflightResult(),
        retrieved_context: [],
      }),
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      status: "drafted",
      artifact: {
        type: "client_email",
        title: "Client email draft",
      },
    });
  });

  it("rejects unauthenticated requests", async () => {
    mocks.auth.mockResolvedValue(null);

    const res = await POST(
      req({
        ask: "Draft the client follow-up.",
        preflight_result: basePreflightResult(),
      }),
    );

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthenticated" });
  });

  it("returns unavailable when the model key is missing", async () => {
    mocks.auth.mockResolvedValue({
      principalId: "principal_user_1",
      apiKey: "csk_test",
    });
    delete process.env.ANTHROPIC_API_KEY;

    const res = await POST(
      req({
        ask: "Draft the client follow-up.",
        preflight_result: basePreflightResult(),
      }),
    );

    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({
      status: "unavailable",
      reason: "workbench_make_model_unavailable",
      message: "Workbench cannot generate a draft right now.",
    });
  });
});

function basePreflightResult(): WorkbenchPreflightResult {
  return {
    decoded_task: {
      summary: "Draft a client follow-up",
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
