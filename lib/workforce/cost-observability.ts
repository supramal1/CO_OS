export type CostAlert = "none" | "near_cap" | "over_cap" | "overrun";

export interface CostTelemetry {
  currentUsd: number;
  maxUsd?: number;
  ratio?: number;
  overrunPct?: number;
  alert: CostAlert;
}

export interface CostObservableTask {
  taskId: string;
  state: string;
  totalCostUsd: number;
  maxCostUsd?: number;
}

export interface WorkforceCostSummary {
  runningUsd: number;
  recentUsd: number;
  cappedTaskCount: number;
  overCapCount: number;
  overrunCount: number;
}

const NEAR_CAP_RATIO = 0.8;
const OVER_CAP_RATIO = 1;
const OVERRUN_RATIO = 1.2;

export function costTelemetryFor(
  currentUsd: number,
  maxUsd?: number,
): CostTelemetry {
  const current = round6(Math.max(0, Number(currentUsd) || 0));
  if (!isPositiveNumber(maxUsd)) {
    return {
      currentUsd: current,
      maxUsd: undefined,
      ratio: undefined,
      overrunPct: undefined,
      alert: "none",
    };
  }

  const max = Number(maxUsd);
  const ratio = current / max;
  const alert: CostAlert =
    ratio >= OVERRUN_RATIO
      ? "overrun"
      : ratio > OVER_CAP_RATIO
        ? "over_cap"
        : ratio >= NEAR_CAP_RATIO
          ? "near_cap"
          : "none";

  return {
    currentUsd: current,
    maxUsd: max,
    ratio,
    overrunPct: ratio > 1 ? (ratio - 1) * 100 : 0,
    alert,
  };
}

export function runningCostUsdFromEvents(
  events: readonly {
    type: string;
    taskId: string;
    payload: Record<string, unknown>;
  }[],
): number {
  const latestByTask = new Map<string, number>();

  for (const event of events) {
    if (event.type !== "model_turn") continue;
    const runningCostUsd = Number(event.payload.runningCostUsd);
    if (!Number.isFinite(runningCostUsd) || runningCostUsd < 0) continue;
    latestByTask.set(event.taskId, runningCostUsd);
  }

  let total = 0;
  for (const cost of latestByTask.values()) total += cost;
  return round6(total);
}

export function workforceCostSummary(
  tasks: readonly CostObservableTask[],
): WorkforceCostSummary {
  let runningUsd = 0;
  let recentUsd = 0;
  let cappedTaskCount = 0;
  let overCapCount = 0;
  let overrunCount = 0;

  for (const task of tasks) {
    const cost = Math.max(0, Number(task.totalCostUsd) || 0);
    recentUsd += cost;
    if (task.state === "running") runningUsd += cost;

    const telemetry = costTelemetryFor(cost, task.maxCostUsd);
    if (telemetry.maxUsd !== undefined) cappedTaskCount++;
    if (telemetry.alert === "over_cap" || telemetry.alert === "overrun") {
      overCapCount++;
    }
    if (telemetry.alert === "overrun") overrunCount++;
  }

  return {
    runningUsd: round6(runningUsd),
    recentUsd: round6(recentUsd),
    cappedTaskCount,
    overCapCount,
    overrunCount,
  };
}

function isPositiveNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function round6(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}
