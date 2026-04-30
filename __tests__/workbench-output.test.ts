import { describe, expect, it } from "vitest";
import {
  buildDocxScaffoldSpec,
  buildPptxScaffoldSpec,
  buildSheetsScaffoldSpec,
} from "@/lib/workbench/output";

describe("Workbench output scaffold specs", () => {
  it("builds deterministic DOCX scaffold specs from structured sections", () => {
    expect(
      buildDocxScaffoldSpec({
        title: "Launch Brief",
        sections: [
          { heading: "Goal", bullets: ["Explain Workbench V1"] },
          { heading: "Risks", body: "Keep output deterministic." },
        ],
        metadata: { requestedBy: "Malik", taskType: "doc_scaffold" },
      }),
    ).toEqual({
      kind: "docx",
      title: "Launch Brief",
      metadata: { requestedBy: "Malik", taskType: "doc_scaffold" },
      sections: [
        {
          heading: "Goal",
          blocks: [{ type: "bullet_list", items: ["Explain Workbench V1"] }],
        },
        {
          heading: "Risks",
          blocks: [{ type: "paragraph", text: "Keep output deterministic." }],
        },
      ],
    });
  });

  it("builds deterministic PPTX scaffold specs with ordered slides", () => {
    expect(
      buildPptxScaffoldSpec({
        title: "Workbench Review",
        slides: [
          { title: "Context", bullets: ["Native generators", "Drive save-back"] },
          { title: "Next", speakerNotes: "Add real byte renderer later." },
        ],
      }),
    ).toEqual({
      kind: "pptx",
      title: "Workbench Review",
      slides: [
        {
          title: "Context",
          layout: "title-and-bullets",
          blocks: [{ type: "bullet_list", items: ["Native generators", "Drive save-back"] }],
          speakerNotes: null,
        },
        {
          title: "Next",
          layout: "title-and-bullets",
          blocks: [],
          speakerNotes: "Add real byte renderer later.",
        },
      ],
    });
  });

  it("builds deterministic Sheets scaffold specs with stable columns and rows", () => {
    expect(
      buildSheetsScaffoldSpec({
        title: "Tasks",
        sheets: [
          {
            name: "Plan",
            columns: ["Task", "Owner"],
            rows: [
              ["Draft", "Workbench"],
              ["Review", null],
            ],
          },
        ],
      }),
    ).toEqual({
      kind: "sheets",
      title: "Tasks",
      sheets: [
        {
          name: "Plan",
          columns: ["Task", "Owner"],
          rows: [
            ["Draft", "Workbench"],
            ["Review", null],
          ],
        },
      ],
    });
  });
});
