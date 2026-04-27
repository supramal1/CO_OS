import { describe, expect, it } from "vitest";
import {
  costTelemetryFor,
  runningCostUsdFromEvents,
  workforceCostSummary,
  type CostObservableTask,
} from "@/lib/workforce/cost-observability";

describe("costTelemetryFor", () => {
  it("classifies cost against approved thresholds", () => {
    expect(costTelemetryFor(3.95, 5).alert).toBe("none");
    expect(costTelemetryFor(4, 5).alert).toBe("near_cap");
    expect(costTelemetryFor(5.01, 5).alert).toBe("over_cap");
    expect(costTelemetryFor(6, 5).alert).toBe("overrun");
  });

  it("flags the Alan smoke overrun at 32 percent over cap", () => {
    const telemetry = costTelemetryFor(6.61, 5);

    expect(telemetry.alert).toBe("overrun");
    expect(telemetry.ratio).toBeCloseTo(1.322, 6);
    expect(telemetry.overrunPct).toBeCloseTo(32.2, 1);
  });

  it("leaves uncapped tasks unalerted", () => {
    expect(costTelemetryFor(12, undefined)).toEqual({
      currentUsd: 12,
      maxUsd: undefined,
      ratio: undefined,
      overrunPct: undefined,
      alert: "none",
    });
  });
});

describe("runningCostUsdFromEvents", () => {
  it("sums the latest model_turn running cost per task in a delegation tree", () => {
    const cost = runningCostUsdFromEvents([
      event("parent", 1, 1.2),
      event("child-a", 2, 0.4),
      event("parent", 3, 1.6),
      event("child-b", 4, 0.7),
      event("child-a", 5, 0.9),
    ]);

    expect(cost).toBeCloseTo(3.2, 6);
  });
});

describe("workforceCostSummary", () => {
  it("aggregates running and recent task spend plus alert counts", () => {
    const tasks: CostObservableTask[] = [
      task("running-a", "running", 4.2, 5),
      task("running-b", "running", 6.61, 5),
      task("done", "completed", 2.5),
    ];

    const summary = workforceCostSummary(tasks);

    expect(summary.runningUsd).toBeCloseTo(10.81, 6);
    expect(summary.recentUsd).toBeCloseTo(13.31, 6);
    expect(summary.cappedTaskCount).toBe(2);
    expect(summary.overCapCount).toBe(1);
    expect(summary.overrunCount).toBe(1);
  });
});

function event(taskId: string, seq: number, runningCostUsd: number) {
  return {
    type: "model_turn",
    timestamp: "2026-04-27T00:00:00.000Z",
    seq,
    taskId,
    agentId: "ada",
    payload: { runningCostUsd },
  };
}

function task(
  taskId: string,
  state: CostObservableTask["state"],
  totalCostUsd: number,
  maxCostUsd?: number,
): CostObservableTask {
  return {
    taskId,
    state,
    totalCostUsd,
    maxCostUsd,
  };
}
