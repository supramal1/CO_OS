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
