import type { DeckTemplate } from "./template-types";

type SkillLike = {
  name: string;
  version: string | null;
};

type StorylineSlide = {
  slideNumber?: number;
  slide_number?: number;
  title?: string;
  purpose?: string;
};

export type DeckTemplateSelectionResult =
  | {
      status: "selected";
      template_id: string;
      template_name: string;
      google_slides_template_id: string;
      reason: string;
      layout_mapping: Array<{
        slide_number: number;
        storyline_title: string;
        layout_role: string;
      }>;
      skill_name: "deck-template-selector";
      skill_version: string | null;
      warnings: string[];
    }
  | {
      status: "template_required" | "template_not_ready";
      template_id?: string;
      template_name?: string;
      skill_name: "deck-template-selector";
      skill_version: string | null;
      warnings: string[];
    };

export async function selectDeckTemplateForStoryline(input: {
  apiKey: string;
  storyline: unknown;
  templates: DeckTemplate[];
  requestedTemplateId?: string | null;
  skillLoader?: (apiKey: string, name: string) => Promise<SkillLike>;
}): Promise<DeckTemplateSelectionResult> {
  const skill = await (input.skillLoader ?? defaultSkillLoader)(
    input.apiKey,
    "deck-template-selector",
  );
  const skillMeta = {
    skill_name: "deck-template-selector" as const,
    skill_version: skill.version ?? null,
  };

  const template = selectTemplate(input.templates, input.requestedTemplateId);
  if (!template) {
    return {
      status: "template_required",
      ...skillMeta,
      warnings: ["no_active_deck_template_available"],
    };
  }
  if (!template.google_slides_template_id?.trim()) {
    return {
      status: "template_not_ready",
      template_id: template.id,
      template_name: template.name,
      ...skillMeta,
      warnings: ["selected_template_missing_google_slides_template_id"],
    };
  }

  return {
    status: "selected",
    template_id: template.id,
    template_name: template.name,
    google_slides_template_id: template.google_slides_template_id,
    reason: template.is_default
      ? `Active default template selected: ${template.name}.`
      : `Requested template selected: ${template.name}.`,
    layout_mapping: mapStorylineToLayouts(input.storyline, template),
    ...skillMeta,
    warnings: [],
  };
}

async function defaultSkillLoader(
  apiKey: string,
  name: string,
): Promise<SkillLike> {
  const { loadWorkbenchSkill } = await import("@/lib/workbench/skill-loader");
  return loadWorkbenchSkill(apiKey, name);
}

export function stripJsonCodeFence(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed.startsWith("```")) return trimmed;
  return trimmed
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

function selectTemplate(
  templates: DeckTemplate[],
  requestedTemplateId?: string | null,
): DeckTemplate | null {
  const active = templates.filter((template) => template.status === "active");
  const requested = requestedTemplateId
    ? active.find((template) => template.id === requestedTemplateId)
    : null;
  return requested ?? active.find((template) => template.is_default) ?? null;
}

function mapStorylineToLayouts(
  storyline: unknown,
  template: DeckTemplate,
): Array<{
  slide_number: number;
  storyline_title: string;
  layout_role: string;
}> {
  const slides = readStorylineSlides(storyline);
  const roles = template.layout_manifest.roles ?? [];
  return slides.map((slide, index) => {
    const slideNumber = slide.slideNumber ?? slide.slide_number ?? index + 1;
    return {
      slide_number: slideNumber,
      storyline_title: slide.title ?? `Slide ${slideNumber}`,
      layout_role: chooseLayoutRole(slide, index, roles),
    };
  });
}

function readStorylineSlides(storyline: unknown): StorylineSlide[] {
  if (!storyline || typeof storyline !== "object") return [];
  const slides = (storyline as { slides?: unknown }).slides;
  return Array.isArray(slides) ? (slides as StorylineSlide[]) : [];
}

function chooseLayoutRole(
  slide: StorylineSlide,
  index: number,
  roles: string[],
): string {
  const purpose = slide.purpose?.trim();
  if (purpose && roles.includes(purpose)) return purpose;
  if (index === 0 && roles.includes("cover")) return "cover";
  return roles.includes("narrative") ? "narrative" : roles[0] ?? "narrative";
}
