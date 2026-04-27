import { describe, it, expect } from "vitest";
import {
  LANE_ORDER,
  boardColumnForLane,
  resolveBoardDrop,
  HUMAN_GATED_TRANSITIONS,
  isAllowedTransition,
  endpointForTransition,
  type ForgeLane,
} from "@/lib/agents-types";

// These tests encode KR-2's state machine. A regression here silently
// changes which cornerstone-agents endpoint fires on a drag — e.g. a
// backlog→research drag hitting /resume instead of /invoke would POST
// to a session that doesn't exist yet. Keep this file strict.

describe("ForgeLane state machine", () => {
  it("LANE_ORDER matches the 6-lane model", () => {
    expect(LANE_ORDER).toEqual([
      "backlog",
      "research",
      "research_review",
      "production",
      "production_review",
      "done",
    ]);
  });

  it("allows exactly three human-gated drags", () => {
    expect(HUMAN_GATED_TRANSITIONS).toEqual([
      ["backlog", "research"],
      ["research_review", "production"],
      ["production_review", "done"],
    ]);
  });

  it("rejects backward drags", () => {
    const backward: Array<[ForgeLane, ForgeLane]> = [
      ["research", "backlog"],
      ["research_review", "research"],
      ["production", "research_review"],
      ["production_review", "production"],
      ["done", "production_review"],
    ];
    for (const [f, t] of backward) {
      expect(isAllowedTransition(f, t)).toBe(false);
    }
  });

  it("rejects skipping lanes", () => {
    const skips: Array<[ForgeLane, ForgeLane]> = [
      ["backlog", "research_review"],
      ["backlog", "production"],
      ["research", "production"],
      ["research_review", "production_review"],
      ["production", "done"],
    ];
    for (const [f, t] of skips) {
      expect(isAllowedTransition(f, t)).toBe(false);
    }
  });

  it("rejects self-loops", () => {
    for (const lane of LANE_ORDER) {
      expect(isAllowedTransition(lane, lane)).toBe(false);
    }
  });
});

describe("endpointForTransition", () => {
  it("maps backlog→research to /invoke (spawns a fresh PM run)", () => {
    expect(endpointForTransition("backlog", "research")).toEqual({
      kind: "invoke",
    });
  });

  it("maps research_review→production to /resume for the scope gate", () => {
    expect(endpointForTransition("research_review", "production")).toEqual({
      kind: "resume",
      gate: "scope",
    });
  });

  it("maps production_review→done to /resume for the build gate", () => {
    expect(endpointForTransition("production_review", "done")).toEqual({
      kind: "resume",
      gate: "build",
    });
  });

  it("returns null for any transition the UI should not offer", () => {
    expect(endpointForTransition("research", "research_review")).toBeNull();
    expect(endpointForTransition("production", "production_review")).toBeNull();
    expect(endpointForTransition("backlog", "done")).toBeNull();
  });

  it("every human-gated transition has an endpoint", () => {
    for (const [f, t] of HUMAN_GATED_TRANSITIONS) {
      expect(endpointForTransition(f, t)).not.toBeNull();
    }
  });
});

describe("Agents 4-column lane mapping", () => {
  it("collapses canonical lanes into the approved /agents columns", () => {
    expect(boardColumnForLane("backlog")).toBe("backlog");
    expect(boardColumnForLane("research")).toBe("in_progress");
    expect(boardColumnForLane("production")).toBe("in_progress");
    expect(boardColumnForLane("research_review")).toBe("review");
    expect(boardColumnForLane("production_review")).toBe("review");
    expect(boardColumnForLane("done")).toBe("done");
  });

  it("resolves 4-column drops to canonical Forge transitions", () => {
    expect(resolveBoardDrop("backlog", "in_progress")).toEqual({
      type: "transition",
      fromLane: "backlog",
      toLane: "research",
    });
    expect(resolveBoardDrop("research_review", "in_progress")).toEqual({
      type: "transition",
      fromLane: "research_review",
      toLane: "production",
    });
    expect(resolveBoardDrop("production_review", "done")).toEqual({
      type: "transition",
      fromLane: "production_review",
      toLane: "done",
    });
  });

  it("treats drops within a collapsed column as no-ops", () => {
    expect(resolveBoardDrop("research", "in_progress")).toEqual({
      type: "noop",
    });
    expect(resolveBoardDrop("production_review", "review")).toEqual({
      type: "noop",
    });
  });

  it("explains automated Review moves instead of returning a vague block", () => {
    expect(resolveBoardDrop("research", "review")).toEqual({
      type: "blocked",
      message: "Tasks move to Review automatically when work completes.",
    });
    expect(resolveBoardDrop("production", "review")).toEqual({
      type: "blocked",
      message: "Tasks move to Review automatically when work completes.",
    });
  });
});
