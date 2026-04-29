import { describe, expect, it } from "vitest";
import {
  estimatedBeforeMinutesFor,
  workbenchBaselineTaskTypes,
} from "@/lib/workbench/baselines";

describe("Workbench hours-saved baselines", () => {
  it("loads the ask_decode baseline from source-controlled config", () => {
    expect(estimatedBeforeMinutesFor("ask_decode")).toBe(30);
  });

  it("falls back to ask_decode for unknown task types", () => {
    expect(estimatedBeforeMinutesFor("not_real")).toBe(30);
  });

  it("exposes configured task types for logging and future aggregation", () => {
    expect(workbenchBaselineTaskTypes()).toContain("ask_decode");
    expect(workbenchBaselineTaskTypes()).toContain("draft_check");
  });
});
