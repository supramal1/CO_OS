import { describe, expect, it } from "vitest";
import {
  selectDeckTemplateForStoryline,
  stripJsonCodeFence,
} from "@/lib/deck/template-selection";
import type { DeckTemplate } from "@/lib/deck/template-types";

const wppTemplate = {
  id: "tpl_wpp",
  name: "WPP Media NEW Template - Google Version",
  brand: "WPP Media",
  client: "WPP Media",
  use_case: "exec_summary",
  status: "active",
  source_pptx_path:
    "/Users/malik.james-williams/Desktop/WPP Media NEW Template - Google Version [COPY ONLY].pptx",
  google_slides_template_id: "slides-template-wpp",
  google_slides_template_url:
    "https://docs.google.com/presentation/d/slides-template-wpp/edit",
  is_default: true,
  layout_manifest: {
    roles: ["cover", "narrative", "evidence", "recommendation", "roadmap"],
  },
  created_at: "2026-05-01T10:00:00.000Z",
  updated_at: "2026-05-01T10:00:00.000Z",
} satisfies DeckTemplate;

describe("deck template workflow selection", () => {
  it("loads deck-template-selector and selects the active default template", async () => {
    const loadedSkills: string[] = [];

    const result = await selectDeckTemplateForStoryline({
      apiKey: "co-api-key",
      storyline: {
        slides: [
          { slideNumber: 1, title: "WPP Media needs a clearer AI operations spine" },
          { slideNumber: 2, title: "Three delivery gaps slow client work" },
        ],
      },
      templates: [wppTemplate],
      skillLoader: async (_apiKey, name) => {
        loadedSkills.push(name);
        return { name, version: "0.1.2" };
      },
    });

    expect(loadedSkills).toEqual(["deck-template-selector"]);
    expect(result).toMatchObject({
      status: "selected",
      template_id: "tpl_wpp",
      template_name: "WPP Media NEW Template - Google Version",
      google_slides_template_id: "slides-template-wpp",
      skill_name: "deck-template-selector",
      skill_version: "0.1.2",
      warnings: [],
    });
    expect(result.status).toBe("selected");
    if (result.status !== "selected") throw new Error("expected selected");
    expect(result.layout_mapping).toEqual([
      {
        slide_number: 1,
        storyline_title: "WPP Media needs a clearer AI operations spine",
        layout_role: "cover",
      },
      {
        slide_number: 2,
        storyline_title: "Three delivery gaps slow client work",
        layout_role: "narrative",
      },
    ]);
  });

  it("blocks generation when the selected template has no Google Slides id", async () => {
    const result = await selectDeckTemplateForStoryline({
      apiKey: "co-api-key",
      storyline: { slides: [] },
      templates: [{ ...wppTemplate, google_slides_template_id: null }],
      skillLoader: async (_apiKey, name) => ({ name, version: "0.1.2" }),
    });

    expect(result).toEqual({
      status: "template_not_ready",
      template_id: "tpl_wpp",
      template_name: "WPP Media NEW Template - Google Version",
      skill_name: "deck-template-selector",
      skill_version: "0.1.2",
      warnings: ["selected_template_missing_google_slides_template_id"],
    });
  });

  it("strips JSON code fences from hosted skill responses", () => {
    expect(stripJsonCodeFence("```json\n{\"status\":\"selected\"}\n```")).toBe(
      "{\"status\":\"selected\"}",
    );
    expect(stripJsonCodeFence(" {\"status\":\"selected\"} ")).toBe(
      "{\"status\":\"selected\"}",
    );
  });
});
