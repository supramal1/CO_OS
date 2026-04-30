import { describe, expect, it, vi } from "vitest";
import {
  reviewWorkbenchArtifact,
  type WorkbenchReviewModelClient,
} from "@/lib/workbench/review";
import type { WorkbenchArtifact } from "@/lib/workbench/make";
import type { WorkbenchPreflightResult } from "@/lib/workbench/types";

describe("Workbench review gate", () => {
  it("returns deterministic senior checks for a thin unsupported artefact", async () => {
    const result = await reviewWorkbenchArtifact({
      ask: "Draft a client email to explain the delayed plan.",
      preflightResult: basePreflightResult(),
      artifact: {
        ...baseArtifact(),
        body: "Sorry, there are recent performance issues.",
        source_refs: [],
      },
      modelClient: null,
    });

    expect(result).toMatchObject({
      status: "reviewed",
      review: {
        senior_challenge: expect.any(Array),
        assumptions: expect.any(Array),
        evidence_gaps: expect.any(Array),
        cookbook_check: expect.any(Array),
        tone_check: expect.any(Array),
        manual_verification: expect.any(Array),
        overall_status: "needs_revision",
      },
    });
    expect(result.review.senior_challenge.join(" ")).toContain("thin");
    expect(result.review.evidence_gaps.join(" ")).toContain("source");
    expect(result.review.tone_check.join(" ")).toContain("apologetic");
    expect(result.review.manual_verification.join(" ")).toContain("Cookbook");
  });

  it("adds model review without removing deterministic warnings", async () => {
    const modelClient: WorkbenchReviewModelClient = {
      create: vi.fn(async () =>
        JSON.stringify({
          review: {
            senior_challenge: [
              "The rationale needs one sentence explaining the trade-off.",
            ],
            assumptions: ["The revised delivery date is approved."],
            evidence_gaps: [],
            cookbook_check: ["Check against the client email tone rubric."],
            tone_check: [],
            manual_verification: ["Confirm Friday timing with the project lead."],
            overall_status: "approved_with_checks",
          },
        }),
      ),
    };

    const result = await reviewWorkbenchArtifact({
      ask: "Draft a client email to explain the delayed plan.",
      preflightResult: basePreflightResult(),
      artifact: {
        ...baseArtifact(),
        body: "Sorry, there are recent performance issues.",
        source_refs: [],
      },
      modelClient,
    });

    expect(result.review.overall_status).toBe("needs_revision");
    expect(result.review.senior_challenge).toEqual(
      expect.arrayContaining([
        expect.stringContaining("thin"),
        "The rationale needs one sentence explaining the trade-off.",
      ]),
    );
    expect(result.review.cookbook_check).toContain(
      "Check against the client email tone rubric.",
    );
  });

  it("keeps provider failures out of staff-facing review output", async () => {
    const modelClient: WorkbenchReviewModelClient = {
      create: vi.fn(async () => {
        throw new Error("401 invalid x-api-key req_secret");
      }),
    };

    const result = await reviewWorkbenchArtifact({
      ask: "Review this draft.",
      preflightResult: basePreflightResult(),
      artifact: baseArtifact(),
      modelClient,
    });

    expect(result.status).toBe("reviewed");
    expect(result.warnings).toEqual(["workbench_review_model_failed"]);
    expect(JSON.stringify(result)).not.toContain("invalid x-api-key");
    expect(JSON.stringify(result)).not.toContain("req_secret");
  });
});

function baseArtifact(): WorkbenchArtifact {
  return {
    type: "client_email",
    title: "Client delay update",
    body: "Hi Sam,\n\nThe plan will arrive on Friday with next steps.",
    assumptions: ["Friday timing is approved."],
    source_refs: [
      {
        source_type: "calendar",
        source_label: "Client check-in",
        source_url: "https://calendar.google.com/event?eid=event-1",
        claim: "Client check-in is today.",
      },
    ],
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
    missing_context: [
      {
        question: "What revised date has been approved?",
        why: "Avoid promising an unapproved date.",
      },
    ],
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
