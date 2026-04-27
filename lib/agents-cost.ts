import type { ForgeLane, ForgeTask } from "@/lib/agents-types";
import {
  costEstimateFor,
  type CostEstimate,
  type CostRunRow,
} from "@/lib/cost-samples";

const SKIP_CONFIRM: Array<[ForgeLane, ForgeLane]> = [
  ["production_review", "done"],
];

export type AgentsCostTransition = {
  taskId: string;
  taskTitle: string;
  from: ForgeLane;
  to: ForgeLane;
  estimate: CostEstimate | null;
  estimateError: boolean;
};

export function shouldSkipAgentsCostConfirm(
  from: ForgeLane,
  to: ForgeLane,
): boolean {
  return SKIP_CONFIRM.some(([f, t]) => f === from && t === to);
}

export function buildAgentsCostTransition({
  task,
  from,
  to,
  costRows,
  costRowsError,
}: {
  task: ForgeTask;
  from: ForgeLane;
  to: ForgeLane;
  costRows: CostRunRow[] | null;
  costRowsError: boolean;
}): AgentsCostTransition {
  return {
    taskId: task.id,
    taskTitle: task.title,
    from,
    to,
    estimate: costRows ? costEstimateFor(costRows, from, to) : null,
    estimateError: costRowsError && !costRows,
  };
}

function numericMetadataCost(metadata: ForgeTask["metadata"]): number | null {
  const value = metadata?.totalCostUsd ?? metadata?.costUsd;
  const cost = typeof value === "number" || typeof value === "string"
    ? Number(value)
    : NaN;
  return Number.isFinite(cost) && cost > 0 ? cost : null;
}

export function displayCostUsdForTask(
  task: ForgeTask,
  costRows: CostRunRow[] | null = null,
): number | null {
  const metadataCost = numericMetadataCost(task.metadata);
  if (metadataCost !== null) return metadataCost;
  if (!costRows) return null;

  let total = 0;
  for (const row of costRows) {
    if (row.task_id !== task.id) continue;
    const cost = row.actual_cost_usd == null ? 0 : Number(row.actual_cost_usd);
    if (Number.isFinite(cost) && cost > 0) total += cost;
  }
  return total > 0 ? total : null;
}

export function formatTaskCostSummary(costUsd: number | null): string {
  return costUsd === null ? "No recorded spend" : `$${costUsd.toFixed(2)} USD`;
}
