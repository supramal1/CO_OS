import { describe, expect, it } from "vitest";
import {
  buildPreflightPrompt,
  parseWorkbenchPreflightResult,
} from "@/lib/workbench/preflight";

describe("Workbench pre-flight prompt", () => {
  it("uses a staff-ready fallback when source-traced retrieval is empty", () => {
    const prompt = buildPreflightPrompt({
      ask: "Can you help me respond to this EM ask?",
      retrievedContext: [],
    });

    expect(prompt).toContain("Can you help me respond to this EM ask?");
    expect(prompt).toContain("No source-traced context was available");
    expect(prompt).toContain("retrieved_context");
    expect(prompt).not.toMatch(/poc|demo|until connectors are wired/i);
  });

  it("adds effective profile context without leaking raw profile source urls", () => {
    const prompt = buildPreflightPrompt({
      ask: "Draft the status update in my usual style.",
      retrievedContext: [],
      profileContext: {
        role: "Strategist",
        current_work: ["Nike QBR"],
        communication_style: "Short, direct bullets",
        challenge_style: "Challenge weak assumptions",
        working_context: ["Prefers source-traced context"],
        do_not_assume: ["Do not invent client facts"],
        source_refs: [
          {
            source: "notion",
            label: "Notion: Voice",
            url: "https://notion.test/raw-page-id",
            page_title: "Voice",
          },
        ],
        updated_at: "2026-04-30T10:00:00.000Z",
        warnings: [],
        summary_text: "Communication style: Short, direct bullets",
      },
    });

    expect(prompt).toContain("Effective staff profile");
    expect(prompt).toContain("Communication style: Short, direct bullets");
    expect(prompt).toContain("Notion: Voice");
    expect(prompt).not.toContain("raw-page-id");
  });
});

describe("Workbench pre-flight parsing", () => {
  it("parses fenced JSON into the Workbench start result shape", () => {
    const result = parseWorkbenchPreflightResult(`Here is the result:

\`\`\`json
{
  "decoded_task": {
    "summary": "Decode the ask",
    "requester": "EM",
    "deliverable_type": "written_response",
    "task_type": "ask_decode"
  },
  "missing_context": [
    { "question": "What is the deadline?", "why": "Needed for prioritization" }
  ],
  "drafted_clarifying_message": "Can you confirm the deadline?",
  "retrieved_context": [],
  "suggested_approach": [
    { "step": "Confirm the decision needed", "rationale": "Keeps the response focused" }
  ],
  "time_estimate": {
    "estimated_before_minutes": 30,
    "estimated_workbench_minutes": 10,
    "task_type": "ask_decode"
  },
  "warnings": ["No source-traced context was available."]
}
\`\`\`
`);

    expect(result.decoded_task.summary).toBe("Decode the ask");
    expect(result.missing_context[0]?.question).toBe("What is the deadline?");
    expect(result.retrieved_context).toEqual([]);
    expect(result.time_estimate.estimated_before_minutes).toBe(30);
  });

  it("throws a useful error when the model response is not JSON", () => {
    expect(() => parseWorkbenchPreflightResult("not json")).toThrow(
      "workbench_preflight_invalid_json",
    );
  });
});
