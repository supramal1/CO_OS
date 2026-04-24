import { describe, it, expect } from "vitest";
import {
  costEstimateFor,
  type CostRunRow,
} from "@/lib/cost-samples";

// These tests encode KR-3's cost estimand. The key invariant is
// sum-per-task: a backlog→research drop spawns a PM run + N research
// sub-runs, so the user-facing estimate is the sum of that fan-out,
// not any single run's cost. Raw per-run pooling would produce bimodal
// distributions and misleading percentiles.

function row(
  task_id: string,
  run_type: string,
  cost: number | string | null,
): CostRunRow {
  return { task_id, run_type, actual_cost_usd: cost };
}

describe("costEstimateFor — backlog→research", () => {
  it("sums pm_orchestration + research per task before taking percentiles", () => {
    // Task A: $1 PM + $0.10 + $0.20 research = $1.30
    // Task B: $2 PM + $0.40 research = $2.40
    // Task C: $0.50 PM + $0.25 + $0.25 research = $1.00
    const rows: CostRunRow[] = [
      row("A", "pm_orchestration", 1),
      row("A", "research", 0.1),
      row("A", "research", 0.2),
      row("B", "pm_orchestration", 2),
      row("B", "research", 0.4),
      row("C", "pm_orchestration", 0.5),
      row("C", "research", 0.25),
      row("C", "research", 0.25),
    ];
    const est = costEstimateFor(rows, "backlog", "research");
    expect(est).not.toBeNull();
    expect(est!.sampleSize).toBe(3);
    // Sorted task sums: [1.00, 1.30, 2.40]
    // p50 (median) = 1.30
    // p90 linear interp between rank 1.8 = 1.30 + 0.8*(2.40-1.30) = 2.18
    expect(est!.p50).toBeCloseTo(1.3, 6);
    expect(est!.p90).toBeCloseTo(2.18, 6);
  });

  it("ignores build runs for backlog→research", () => {
    const rows: CostRunRow[] = [
      row("A", "pm_orchestration", 1),
      row("A", "build", 5), // out of pool
    ];
    const est = costEstimateFor(rows, "backlog", "research");
    expect(est!.sampleSize).toBe(1);
    expect(est!.p50).toBe(1);
  });

  it("coerces numeric strings from Supabase", () => {
    const rows: CostRunRow[] = [
      row("A", "pm_orchestration", "1.25"),
      row("A", "research", "0.75"),
    ];
    const est = costEstimateFor(rows, "backlog", "research");
    expect(est!.sampleSize).toBe(1);
    expect(est!.p50).toBeCloseTo(2.0, 6);
  });

  it("skips runs with non-positive or null costs", () => {
    const rows: CostRunRow[] = [
      row("A", "pm_orchestration", 1),
      row("B", "pm_orchestration", null),
      row("C", "pm_orchestration", 0),
      row("D", "pm_orchestration", -0.5),
    ];
    const est = costEstimateFor(rows, "backlog", "research");
    // Only A has positive cost.
    expect(est!.sampleSize).toBe(1);
  });

  it("returns sampleSize 0 when no matching rows exist", () => {
    const est = costEstimateFor([], "backlog", "research");
    expect(est!.sampleSize).toBe(0);
    expect(est!.p50).toBe(0);
    expect(est!.p90).toBe(0);
  });
});

describe("costEstimateFor — research_review→production", () => {
  it("sums build runs per task (retries included)", () => {
    const rows: CostRunRow[] = [
      row("A", "build", 3),
      row("A", "build", 2), // retry on same task
      row("B", "build", 4),
    ];
    const est = costEstimateFor(rows, "research_review", "production");
    expect(est!.sampleSize).toBe(2);
    // Sorted: [4, 5]
    expect(est!.p50).toBe(4.5);
  });

  it("ignores pm_orchestration and research for this transition", () => {
    const rows: CostRunRow[] = [
      row("A", "pm_orchestration", 10),
      row("A", "research", 10),
      row("A", "build", 1),
    ];
    const est = costEstimateFor(rows, "research_review", "production");
    expect(est!.sampleSize).toBe(1);
    expect(est!.p50).toBe(1);
  });
});

describe("costEstimateFor — unknown transitions", () => {
  it("returns null for production_review→done (no spend, modal is skipped)", () => {
    expect(costEstimateFor([], "production_review", "done")).toBeNull();
  });

  it("returns null for any non-mapped transition", () => {
    expect(costEstimateFor([], "research", "research_review")).toBeNull();
    expect(costEstimateFor([], "backlog", "done")).toBeNull();
  });
});
