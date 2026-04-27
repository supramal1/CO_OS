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
