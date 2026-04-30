import { describe, expect, it } from "vitest";
import {
  buildPresendPrompt,
  parseWorkbenchPresendResult,
} from "@/lib/workbench/presend";

const preflightResult = {
  decoded_task: {
    summary: "Prepare a client-ready follow-up note",
    requester: "EM",
    deliverable_type: "written_response",
    task_type: "draft_check",
  },
  missing_context: [],
  drafted_clarifying_message: "",
  retrieved_context: [
    {
      claim: "Calendar event: Client QBR on 2026-05-04",
      source_type: "calendar",
      source_label: "Client QBR",
      source_url: "https://calendar.google.com/event?eid=qbr",
    },
  ],
  suggested_approach: [
    {
      step: "Prepare a concise follow-up note",
      rationale: "The recipient needs the next steps.",
    },
  ],
  time_estimate: {
    estimated_before_minutes: 35,
    estimated_workbench_minutes: 12,
    task_type: "draft_check",
  },
  warnings: [],
};

describe("Workbench presend prompt", () => {
  it("asks for artifact intent and save-back requirements without generating files", () => {
    const prompt = buildPresendPrompt({
      preflightResult,
      draftInput: "Draft: Thanks for the time today. Next steps are below.",
      artifactSpecInput: "Need a Notion-ready client follow-up note.",
    });

    expect(prompt).toContain("Run Workbench Presend");
    expect(prompt).toContain("artifact_intent");
    expect(prompt).toContain("save_back_requirements");
    expect(prompt).toContain("drive");
    expect(prompt).toContain("Client QBR");
    expect(prompt).toContain("Do not generate finished files");
  });
});

describe("Workbench presend parsing", () => {
  it("parses fenced JSON into structured artifact intent and save-back requirements", () => {
    const result = parseWorkbenchPresendResult(`\`\`\`json
{
  "artifact_intent": {
    "artifact_type": "notion_update",
    "title": "Client follow-up note",
    "audience": "Client team",
    "purpose": "Confirm decisions and next steps"
  },
  "artifact_spec": {
    "format": "notion_page",
    "sections": [
      { "heading": "Decisions", "purpose": "Capture what was agreed" }
    ],
    "source_context": [
      {
        "claim": "Calendar event: Client QBR on 2026-05-04",
        "source_type": "calendar",
        "source_label": "Client QBR",
        "source_url": "https://calendar.google.com/event?eid=qbr"
      }
    ]
  },
  "quality_checks": [
    { "check": "No unsupported claims", "status": "pass", "detail": null }
  ],
  "save_back_requirements": [
    {
      "target": "drive",
      "action": "save_artifact",
      "required": true,
      "reason": "Save the generated scaffold to the configured Workbench folder"
    }
  ],
  "warnings": ["Confirm the external recipient list before sending."]
}
\`\`\``);

    expect(result.artifact_intent).toMatchObject({
      artifact_type: "notion_update",
      title: "Client follow-up note",
    });
    expect(result.artifact_spec.sections[0]?.heading).toBe("Decisions");
    expect(result.save_back_requirements[0]).toMatchObject({
      target: "drive",
      action: "save_artifact",
      required: true,
    });
  });

  it("throws a useful error when the model response is not JSON", () => {
    expect(() => parseWorkbenchPresendResult("not json")).toThrow(
      "workbench_presend_invalid_json",
    );
  });
});
