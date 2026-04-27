import { describe, expect, it } from "vitest";
import {
  buildAgentsCostTransition,
  displayCostUsdForTask,
  shouldSkipAgentsCostConfirm,
} from "@/lib/agents-cost";
import type { CostRunRow } from "@/lib/cost-samples";
import type { ForgeTask } from "@/lib/agents-types";

const task: ForgeTask = {
  id: "task-1",
  title: "Scope the thing",
  description: null,
  lane: "backlog",
  status: "submitted",
  agent_id: null,
  priority: 0,
  creator_type: null,
  creator_id: null,
  assignee_type: null,
  assignee_id: null,
  metadata: null,
  namespace: "aiops",
  created_at: "2026-04-27T00:00:00Z",
  updated_at: "2026-04-27T00:00:00Z",
};

describe("agents cost transition modal helpers", () => {
  it("skips the confirmation modal for production_review to done", () => {
    expect(shouldSkipAgentsCostConfirm("production_review", "done")).toBe(true);
    expect(shouldSkipAgentsCostConfirm("backlog", "research")).toBe(false);
    expect(shouldSkipAgentsCostConfirm("research_review", "production")).toBe(
      false,
    );
  });

  it("builds a pending transition with historical p50/p90 estimates", () => {
    const rows: CostRunRow[] = [
      { task_id: "old-1", run_type: "pm_orchestration", actual_cost_usd: 1 },
      { task_id: "old-1", run_type: "research", actual_cost_usd: 3 },
      { task_id: "old-2", run_type: "pm_orchestration", actual_cost_usd: 2 },
      { task_id: "old-2", run_type: "research", actual_cost_usd: 6 },
    ];

    const pending = buildAgentsCostTransition({
      task,
      from: "backlog",
      to: "research",
      costRows: rows,
      costRowsError: false,
    });

    expect(pending).toEqual({
      taskId: "task-1",
      taskTitle: "Scope the thing",
      from: "backlog",
      to: "research",
      estimate: { p50: 6, p90: 7.6, sampleSize: 2 },
      estimateError: false,
    });
  });

  it("marks the modal as degraded when samples could not be loaded", () => {
    const pending = buildAgentsCostTransition({
      task,
      from: "research_review",
      to: "production",
      costRows: null,
      costRowsError: true,
    });

    expect(pending?.estimate).toBeNull();
    expect(pending?.estimateError).toBe(true);
  });
});

describe("displayCostUsdForTask", () => {
  it("prefers an explicit totalCostUsd from task metadata", () => {
    expect(
      displayCostUsdForTask({
        ...task,
        metadata: { totalCostUsd: 12.345 },
      }),
    ).toBe(12.345);
  });

  it("falls back to summing actual run costs for the task", () => {
    const rows: CostRunRow[] = [
      { task_id: "task-1", run_type: "pm_orchestration", actual_cost_usd: 1.25 },
      { task_id: "task-1", run_type: "research", actual_cost_usd: "2.75" },
      { task_id: "other", run_type: "research", actual_cost_usd: 99 },
      { task_id: "task-1", run_type: "build", actual_cost_usd: null },
    ];

    expect(displayCostUsdForTask(task, rows)).toBe(4);
  });

  it("returns null when the task has no recorded cost", () => {
    expect(displayCostUsdForTask(task, [])).toBeNull();
  });
});
