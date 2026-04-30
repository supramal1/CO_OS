import { describe, expect, it } from "vitest";
import {
  CONNECTED_TOOL_ROWS,
  PROFILE_FACT_ROWS,
  PROFILE_PATH,
  PROFILE_SECTIONS,
  PROFILE_STATS,
} from "@/lib/profile/profile-model";

describe("My OS Profile model", () => {
  it("defines the Phase 1 profile destination and sections", () => {
    expect(PROFILE_PATH).toBe("/profile");
    expect(PROFILE_SECTIONS.map((section) => section.id)).toEqual([
      "my-work",
      "connected-tools",
      "personalisation",
      "privacy",
    ]);
    expect(PROFILE_SECTIONS.find((section) => section.id === "connected-tools")).toMatchObject({
      title: "Connected Tools",
      description:
        "Manage the accounts CO OS uses for context, signals, and approved write-backs.",
    });
  });

  it("starts Connected Tools with the OS-wide integration set", () => {
    expect(CONNECTED_TOOL_ROWS.map((tool) => tool.id)).toEqual([
      "google",
      "calendar",
      "drive",
      "notion",
      "monday",
      "cornerstone",
    ]);
    expect(CONNECTED_TOOL_ROWS.find((tool) => tool.id === "monday")).toMatchObject({
      label: "monday.com",
      role: "Operational task ledger",
      status: "coming_next",
    });
  });

  it("provides identity-strip stats and fact rows for the redesigned profile structure", () => {
    expect(PROFILE_STATS.map((stat) => stat.label)).toEqual([
      "Active projects",
      "Connected tools",
      "Default reviewer",
    ]);
    expect(PROFILE_FACT_ROWS.map((row) => row.label)).toEqual([
      "Role",
      "Team",
      "Active work",
      "Output preference",
      "Private to you",
      "Visible to team",
      "Admin only",
    ]);
  });
});
