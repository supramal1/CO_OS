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
        sourceRefs: ["calendar:event-1"],
        action: { label: "Open Review", target: "review", href: "/forge/production-review" },
      }),
      candidate({
        id: "c",
        title: "Workbench run needs review",
        confidence: "low",
        action: undefined,
        sourceRefs: ["workbench:run-1", "notion:page-1"],
      }),
      candidate({
        id: "d",
        title: "Review flag needs review",
        confidence: "high",
        sourceRefs: ["review:flag-2", "notion:page-1"],
        action: { label: "Open Review", target: "review", href: "/forge/production-review" },
      }),
      candidate({
        id: "e",
        title: "Client X draft is missing evidence",
        confidence: "high",
        sourceRefs: ["workbench:run-9"],
        action: { label: "Open Workbench", target: "workbench", href: "/workbench" },
      }),
      candidate({
        id: "f",
        title: "Client Y draft is missing evidence",
        confidence: "high",
        sourceRefs: ["workbench:run-10"],
        action: { label: "Open Workbench", target: "workbench", href: "/workbench" },
      }),
      candidate({
        id: "g",
        title: "Client X invoice is missing evidence",
        confidence: "high",
        sourceRefs: ["workbench:run-11"],
        action: { label: "Open Workbench", target: "workbench", href: "/workbench" },
      }),
    ]);

    expect(deduped).toHaveLength(4);
    expect(deduped[0]).toMatchObject({
      id: "e",
      confidence: "high",
      action: { label: "Open Workbench" },
    });
    expect(deduped[1]).toMatchObject({
      id: "d",
      confidence: "high",
      action: { label: "Open Review" },
    });
    expect(deduped[2]).toMatchObject({
      id: "f",
      title: "Client Y draft is missing evidence",
    });
    expect(deduped[3]).toMatchObject({
      id: "g",
      title: "Client X invoice is missing evidence",
    });
  });

  it("uses deterministic tie-breakers when items have equal scores", () => {
    const ranked = rankNewsroomItems([
      candidate({
        id: "z",
        title: "Beta item",
        source: "workbench",
        signals: ["active_work"],
      }),
      candidate({
        id: "z",
        title: "Alpha item",
        source: "workbench",
        signals: ["active_work"],
      }),
      candidate({
        id: "a",
        title: "Alpha item",
        source: "workbench",
        signals: ["active_work"],
      }),
    ]);

    expect(ranked.map((item) => `${item.title}:${item.id}`)).toEqual([
      "Alpha item:a",
      "Alpha item:z",
      "Beta item:z",
    ]);
  });

  it("limits sections and suggested actions to the MVP defaults", () => {
    const today = Array.from({ length: 6 }, (_, index) =>
      candidate({
        id: `today-${index}`,
        title: `Today item ${index}`,
        section: "today",
        sourceRefs: [`calendar:${index}`],
      }),
    );
    const changedSinceYesterday = Array.from({ length: 6 }, (_, index) =>
      candidate({
        id: `changed-${index}`,
        title: `Changed item ${index}`,
        section: "changedSinceYesterday",
        sourceRefs: [`notion:${index}`],
      }),
    );
    const needsAttention = Array.from({ length: 6 }, (_, index) =>
      candidate({
        id: `attention-${index}`,
        title: `Attention item ${index}`,
        section: "needsAttention",
        sourceRefs: [`review:${index}`],
      }),
    );
    const many = [...today, ...changedSinceYesterday, ...needsAttention];

    const sections = limitNewsroomSections(many);
    const actions = buildSuggestedActions(many);

    expect(sections.today).toHaveLength(3);
    expect(sections.changedSinceYesterday).toHaveLength(4);
    expect(sections.needsAttention).toHaveLength(4);
    expect(actions).toHaveLength(4);
  });
});
