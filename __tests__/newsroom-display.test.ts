import { describe, expect, it } from "vitest";
import {
  deriveNewsroomEmptyMessage,
  sourceStatusLabel,
} from "@/components/newsroom/newsroom-display";
import type { NewsroomSourceStatus } from "@/lib/newsroom/types";

describe("Newsroom display helpers", () => {
  it("uses setup attention copy when all sources are unavailable or errored", () => {
    const statuses: NewsroomSourceStatus[] = [
      { source: "workbench", status: "unavailable", itemsCount: 0 },
      { source: "notion", status: "error", itemsCount: 0 },
      { source: "cornerstone", status: "unavailable", itemsCount: 0 },
    ];

    expect(deriveNewsroomEmptyMessage(statuses)).toBe(
      "Newsroom could not reach your context sources yet. Workbench setup may need attention.",
    );
  });

  it("uses the default empty copy when sources are ready or empty", () => {
    const statuses: NewsroomSourceStatus[] = [
      { source: "workbench", status: "ok", itemsCount: 1 },
      { source: "notion", status: "empty", itemsCount: 0 },
    ];

    expect(deriveNewsroomEmptyMessage(statuses)).toBe(
      "No major changes found for today. Workbench and Notion are ready when you need them.",
    );
  });

  it("labels source health by source and status", () => {
    expect(
      sourceStatusLabel({ source: "review", status: "empty", itemsCount: 0 }),
    ).toBe("Review empty");
  });
});
