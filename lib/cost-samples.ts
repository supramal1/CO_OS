import type { ForgeLane } from "./agents-types";

// Minimal row shape we care about from forge_task_runs. Supabase returns
// numeric columns as strings when they don't fit a JS number exactly; we
// coerce to number in the selector.
export type CostRunRow = {
  task_id: string;
  run_type: string | null;
  actual_cost_usd: string | number | null;
};

export type CostEstimate = {
  p50: number;
  p90: number;
  sampleSize: number;
};

// One datapoint per historical task — sums all runs the transition would
// trigger on a fresh drop. Sum-per-task is the right estimand because a
// single backlog→research drop spawns 1 PM + N research sub-runs, so the
// user's actual spend-per-drop is the sum. Pooling raw per-run costs
// would produce a bimodal distribution (cheap research sub-runs vs
// expensive PM runs) and misleading percentiles.
function sumsPerTask(
  rows: CostRunRow[],
  runTypes: Set<string>,
): number[] {
  // Include runs regardless of status — a paused, failed, or budget-exceeded
  // run still cost money on the drop that spawned it, so it belongs in the
  // "what does this transition historically cost" pool.
  const perTask = new Map<string, number>();
  for (const r of rows) {
    if (!r.run_type || !runTypes.has(r.run_type)) continue;
    const cost = r.actual_cost_usd == null ? 0 : Number(r.actual_cost_usd);
    if (!Number.isFinite(cost) || cost <= 0) continue;
    perTask.set(r.task_id, (perTask.get(r.task_id) ?? 0) + cost);
  }
  return Array.from(perTask.values());
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  if (sorted.length === 1) return sorted[0];
  // Linear interpolation between the two nearest ranks. Good enough for
  // small sample sizes typical here (tens of tasks).
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

function estimate(samples: number[]): CostEstimate {
  const sorted = [...samples].sort((a, b) => a - b);
  return {
    p50: percentile(sorted, 0.5),
    p90: percentile(sorted, 0.9),
    sampleSize: sorted.length,
  };
}

// Which run_types comprise the spend triggered by each human-gated drag.
// production_review→done is intentionally absent — it's a gate close, no
// API spend, so the modal is skipped upstream.
const TRANSITION_RUN_TYPES: Record<string, Set<string>> = {
  "backlog->research": new Set(["pm_orchestration", "research"]),
  "research_review->production": new Set(["build"]),
};

export function costEstimateFor(
  rows: CostRunRow[],
  from: ForgeLane,
  to: ForgeLane,
): CostEstimate | null {
  const key = `${from}->${to}`;
  const runTypes = TRANSITION_RUN_TYPES[key];
  if (!runTypes) return null;
  return estimate(sumsPerTask(rows, runTypes));
}
