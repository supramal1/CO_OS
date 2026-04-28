import { describe, expect, it } from "vitest";
import {
  activeStatusForTask,
  activeStatusMap,
  type ForgeActiveRunRow,
} from "@/lib/agents-active-status";

describe("agents active status", () => {
  it("uses the latest running forge_task_runs row as the active task signal", () => {
    const rows: ForgeActiveRunRow[] = [
      run({
        id: "old-running",
        task_id: "task-1",
        status: "running",
        run_type: "research",
        started_at: "2026-04-29T10:00:00.000Z",
      }),
      run({
        id: "new-running",
        task_id: "task-1",
        status: "running",
        run_type: "build",
        started_at: "2026-04-29T10:05:00.000Z",
      }),
    ];

    expect(activeStatusForTask(rows, "task-1")).toEqual({
      active: true,
      taskId: "task-1",
      runId: "new-running",
      label: "Build working",
      workerLabel: "Build",
      runLabel: "Build",
      startedAt: "2026-04-29T10:05:00.000Z",
    });
  });

  it("ignores queued, claimed, completed, failed, and cancelled rows", () => {
    const rows: ForgeActiveRunRow[] = [
      run({ task_id: "task-1", status: "queued", run_type: "research" }),
      run({ task_id: "task-1", status: "claimed", run_type: "research" }),
      run({ task_id: "task-1", status: "completed", run_type: "research" }),
      run({ task_id: "task-1", status: "failed", run_type: "research" }),
      run({ task_id: "task-1", status: "cancelled", run_type: "research" }),
    ];

    expect(activeStatusForTask(rows, "task-1")).toEqual({ active: false });
  });

  it("uses a humanised run type for the active worker label", () => {
    const rows: ForgeActiveRunRow[] = [
      run({
        task_id: "task-1",
        status: "running",
        run_type: "pm_orchestration",
      }),
    ];

    expect(activeStatusForTask(rows, "task-1")).toMatchObject({
      active: true,
      label: "PM orchestration working",
      workerLabel: "PM orchestration",
      runLabel: "PM orchestration",
    });
  });

  it("builds a lookup for visible task cards only", () => {
    const rows: ForgeActiveRunRow[] = [
      run({ task_id: "visible", status: "running", run_type: "research" }),
      run({ task_id: "hidden", status: "running", run_type: "build" }),
    ];

    expect([...activeStatusMap(rows, ["visible"]).keys()]).toEqual(["visible"]);
  });
});

function run(overrides: Partial<ForgeActiveRunRow>): ForgeActiveRunRow {
  return {
    id: "run-1",
    task_id: "task-1",
    status: "running",
    run_type: null,
    stage: null,
    started_at: null,
    created_at: "2026-04-29T09:00:00.000Z",
    ...overrides,
  };
}
