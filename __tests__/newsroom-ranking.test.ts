import { describe, expect, it } from "vitest";
import {
  buildSuggestedActions,
  dedupeNewsroomItems,
  limitNewsroomSections,
  rankNewsroomItems,
} from "@/lib/newsroom/ranking";
import type { NewsroomCandidate } from "@/lib/newsroom/types";

const workbenchAction = {
  label: "Open Workbench",
  target: "workbench" as const,
  href: "/workbench",
};

function candidate(
  overrides: Partial<NewsroomCandidate> = {},
): NewsroomCandidate {
  return {
    id: "item-base",
    title: "Project Atlas needs a decision",
    reason: "The client check-in is today and the recommendation is unresolved.",
    source: "workbench",
    confidence: "medium",
    section: "needsAttention",
    href: "/workbench",
    action: workbenchAction,
    signals: ["human_decision", "meeting_today", "action_available"],
    sourceRefs: ["workbench:run-1"],
    ...overrides,
  };
}

describe("Newsroom ranking", () => {
  it("promotes meeting, review, missing-evidence, cross-source, and action-bearing signals", () => {
    const ranked = rankNewsroomItems([
      candidate({
        id: "generic",
        title: "Generic file update",
        confidence: "high",
        signals: ["generic_update"],
        action: undefined,
      }),
      candidate({
        id: "priority",
        title: "Client X draft needs evidence",
        source: "review",
        confidence: "medium",
        signals: [
          "meeting_today",
          "review_unresolved",
          "missing_evidence",
          "cross_source_match",
          "human_decision",
          "action_available",
        ],
        action: { label: "Open Review", target: "review", href: "/forge/production-review" },
      }),
    ]);

    expect(ranked.map((item) => item.id)).toEqual(["priority", "generic"]);
  });

  it("dedupes similar titles and shared source refs while preserving the stronger action", () => {
    const deduped = dedupeNewsroomItems([
      candidate({
        id: "a",
        title: "Client X draft needs evidence",
        confidence: "low",
        action: undefined,
        sourceRefs: ["review:flag-1"],
      }),
      candidate({
        id: "b",
        title: "Client X draft needs evidence.",
        confidence: "high",
        sourceRefs: ["review:flag-1"],
        action: { label: "Open Review", target: "review", href: "/forge/production-review" },
      }),
    ]);

    expect(deduped).toHaveLength(1);
    expect(deduped[0]).toMatchObject({
      id: "b",
      confidence: "high",
      action: { label: "Open Review" },
    });
  });

  it("limits sections and suggested actions to the MVP defaults", () => {
    const many = Array.from({ length: 6 }, (_, index) =>
      candidate({
        id: `today-${index}`,
        title: `Today item ${index}`,
        section: "today",
        sourceRefs: [`calendar:${index}`],
      }),
    );

    const sections = limitNewsroomSections(many);
    const actions = buildSuggestedActions(many);

    expect(sections.today).toHaveLength(3);
    expect(actions).toHaveLength(4);
  });
});
