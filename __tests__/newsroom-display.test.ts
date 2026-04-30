import { describe, expect, it } from "vitest";
import {
  actionLinkAriaLabel,
  deriveNewsroomEmptyMessage,
  newsroomSectionEmptyMessage,
  dismissItemAriaLabel,
  itemActionAriaLabel,
  sourceStatusDetail,
  sourceStatusLabel,
  sourceLinkAriaLabel,
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

  it("uses section-specific empty states instead of generic change copy everywhere", () => {
    const statuses: NewsroomSourceStatus[] = [
      { source: "workbench", status: "ok", itemsCount: 0 },
      { source: "notion", status: "empty", itemsCount: 0 },
    ];

    expect(newsroomSectionEmptyMessage("today", statuses)).toBe(
      "No meetings or active work found for today.",
    );
    expect(newsroomSectionEmptyMessage("changedSinceYesterday", statuses)).toBe(
      "No source-backed changes found since yesterday.",
    );
    expect(newsroomSectionEmptyMessage("needsAttention", statuses)).toBe(
      "No judgement items found right now.",
    );
  });

  it("labels source health by source and status", () => {
    expect(
      sourceStatusLabel({ source: "review", status: "empty", itemsCount: 0 }),
    ).toBe("Review empty");
    expect(
      sourceStatusLabel({
        source: "calendar",
        status: "unavailable",
        reason: "calendar_scope_missing",
        itemsCount: 0,
      }),
    ).toBe("Calendar not connected");
    expect(
      sourceStatusLabel({
        source: "notion",
        status: "error",
        reason: "notion lookup failed",
        itemsCount: 0,
      }),
    ).toBe("Notion not connected");
  });

  it("maps known setup reasons to staff-facing source health detail", () => {
    expect(
      sourceStatusDetail({
        source: "calendar",
        status: "unavailable",
        reason: "calendar_scope_missing",
        itemsCount: 0,
      }),
    ).toBe("Connect Calendar in Workbench");
    expect(
      sourceStatusDetail({
        source: "notion",
        status: "error",
        reason: "notion lookup failed",
        itemsCount: 0,
      }),
    ).toBe("Connect Notion in Workbench");
    expect(
      sourceStatusDetail({
        source: "cornerstone",
        status: "unavailable",
        reason: "Missing API key for Cornerstone",
        itemsCount: 0,
      }),
    ).toBe("Cornerstone is unavailable");
  });

  it("does not return raw infrastructure or token reasons", () => {
    const rawReasons = [
      "Supabase request failed: HTTP 500 with token abc123",
      "invalid refresh_token from Google",
      "postgres connection refused",
    ];

    for (const reason of rawReasons) {
      const detail = sourceStatusDetail({
        source: "notion",
        status: "error",
        reason,
        itemsCount: 0,
      });

      expect(detail).toBe("Check setup or try again");
      expect(detail).not.toContain(reason);
      expect(detail).not.toMatch(/supabase|http|token|postgres/i);
    }
  });

  it("builds item-specific aria labels for repeated controls", () => {
    expect(dismissItemAriaLabel("Client X needs evidence")).toBe(
      "Dismiss Client X needs evidence",
    );
    expect(sourceLinkAriaLabel("Client X needs evidence")).toBe(
      "Open source for Client X needs evidence",
    );
    expect(
      actionLinkAriaLabel({
        label: "Open Workbench",
        target: "workbench",
        href: "/workbench",
      }),
    ).toBe("Open Workbench in Workbench");
    expect(
      itemActionAriaLabel(
        { label: "Open Review", target: "review", href: "/forge/production-review" },
        "Client X needs evidence",
      ),
    ).toBe("Open Review for Client X needs evidence");
  });
});
