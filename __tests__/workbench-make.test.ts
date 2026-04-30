import { describe, expect, it, vi } from "vitest";
import {
  generateWorkbenchArtifact,
  inferWorkbenchArtifactType,
  type WorkbenchMakeModelClient,
} from "@/lib/workbench/make";
import type {
  WorkbenchPreflightResult,
  WorkbenchRetrievedContext,
} from "@/lib/workbench/types";

describe("Workbench make stage", () => {
  it("generates a typed working artefact through an injected model client", async () => {
    const modelClient: WorkbenchMakeModelClient = {
      create: vi.fn(async () =>
        JSON.stringify({
          artifact: {
            type: "client_email",
            title: "Client expectation reset email",
            body: "Hi Sam,\n\nThanks for your patience. We are resetting timing to Friday and will send the updated plan by 3pm.",
            assumptions: ["The revised delivery date is approved."],
            source_refs: [
              {
                source_type: "calendar",
                source_label: "Client check-in",
                source_url: "https://calendar.google.com/event?eid=event-1",
                claim: "Client check-in is today.",
              },
            ],
          },
        }),
      ),
    };

    const result = await generateWorkbenchArtifact({
      ask: "Draft a client email to reset timing.",
      preflightResult: basePreflightResult(),
      retrievedContext: baseContext(),
      modelClient,
    });

    expect(result).toMatchObject({
      status: "drafted",
      artifact: {
        type: "client_email",
        title: "Client expectation reset email",
        body: expect.stringContaining("resetting timing"),
        assumptions: ["The revised delivery date is approved."],
        source_refs: [
          expect.objectContaining({
            source_type: "calendar",
            source_label: "Client check-in",
          }),
        ],
      },
    });
    expect(modelClient.create).toHaveBeenCalledWith(
      expect.objectContaining({
        temperature: 0.2,
        maxTokens: 1800,
        system: expect.stringContaining("Return only strict JSON"),
        prompt: expect.stringContaining("Draft a client email"),
      }),
    );
  });

  it("returns a staff-safe unavailable result when no model client is configured", async () => {
    await expect(
      generateWorkbenchArtifact({
        ask: "Draft a client email.",
        preflightResult: basePreflightResult(),
        retrievedContext: [],
        modelClient: null,
      }),
    ).resolves.toEqual({
      status: "unavailable",
      reason: "workbench_make_model_unavailable",
      message: "Workbench cannot generate a draft right now.",
    });
  });

  it("keeps provider failures out of staff-facing errors", async () => {
    const modelClient: WorkbenchMakeModelClient = {
      create: vi.fn(async () => {
        throw new Error("401 invalid x-api-key req_secret");
      }),
    };

    const result = await generateWorkbenchArtifact({
      ask: "Draft a client email.",
      preflightResult: basePreflightResult(),
      retrievedContext: [],
      modelClient,
    });

    expect(result).toEqual({
      status: "error",
      reason: "anthropic_api_key_rejected",
      message:
        "Anthropic rejected ANTHROPIC_API_KEY. Update the local key and restart the dev server.",
    });
    expect(JSON.stringify(result)).not.toContain("invalid x-api-key");
    expect(JSON.stringify(result)).not.toContain("req_secret");
  });

  it("infers V1 artefact types from the decoded task", () => {
    expect(
      inferWorkbenchArtifactType({
        ...basePreflightResult(),
        decoded_task: {
          ...basePreflightResult().decoded_task,
          summary: "Prepare options and a recommendation for the client",
        },
      }),
    ).toBe("options_recommendation");
    expect(
      inferWorkbenchArtifactType({
        ...basePreflightResult(),
        decoded_task: {
          ...basePreflightResult().decoded_task,
          deliverable_type: "meeting prep",
        },
      }),
    ).toBe("meeting_prep");
  });
});

function baseContext(): WorkbenchRetrievedContext[] {
  return [
    {
      claim: "Client check-in is today.",
      source_type: "calendar",
      source_label: "Client check-in",
      source_url: "https://calendar.google.com/event?eid=event-1",
    },
  ];
}

function basePreflightResult(): WorkbenchPreflightResult {
  return {
    decoded_task: {
      summary: "Draft a client email to reset expectations",
      requester: "Client lead",
      deliverable_type: "client email",
      task_type: "draft_check",
    },
    missing_context: [
      {
        question: "What revised date has been approved?",
        why: "The email needs a clear commitment.",
      },
    ],
    drafted_clarifying_message: "",
    retrieved_context: baseContext(),
    suggested_approach: [
      {
        step: "Acknowledge the delay, reset timing, and give the next step.",
        rationale: "The client needs clarity rather than a long explanation.",
      },
    ],
    time_estimate: {
      estimated_before_minutes: 30,
      estimated_workbench_minutes: 10,
      task_type: "draft_check",
    },
    warnings: [],
  };
}
