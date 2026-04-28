import { describe, expect, it } from "vitest";
import type { ForgeTask } from "@/lib/agents-types";
import {
  buildTaskDetailDisplay,
  type ForgeTaskRunRow,
} from "@/lib/agents-detail-display";

const task: ForgeTask = {
  id: "task-1",
  title: "Restore Forge detail",
  description: "Show run history in /agents.",
  lane: "production_review",
  status: "ready",
  agent_id: "builder",
  priority: 3,
  creator_type: "user",
  creator_id: "mal",
  assignee_type: "agent",
  assignee_id: "builder",
  metadata: { pr_state: "open" },
  namespace: "default",
  created_at: "2026-04-27T10:00:00Z",
  updated_at: "2026-04-27T12:00:00Z",
};

describe("buildTaskDetailDisplay", () => {
  it("maps forge_task_runs into chronological display rows with cost", () => {
    const display = buildTaskDetailDisplay(task, [
      run({
        id: "run-2",
        run_type: "build",
        stage: "awaiting_review",
        status: "completed",
        actual_cost_usd: "2.75",
        created_at: "2026-04-27T11:00:00Z",
      }),
      run({
        id: "run-1",
        run_type: "pm_orchestration",
        stage: "completed",
        status: "completed",
        actual_cost_usd: 1.25,
        created_at: "2026-04-27T10:30:00Z",
      }),
    ]);

    expect(display.runs.map((r) => r.id)).toEqual(["run-1", "run-2"]);
    expect(display.runs[0]).toMatchObject({
      label: "PM orchestration",
      stageLabel: "Completed",
      costUsd: 1.25,
    });
    expect(display.runs[1]).toMatchObject({
      label: "Build",
      stageLabel: "Awaiting review",
      costUsd: 2.75,
    });
  });

  it("extracts scope, PR context, events, and markdown output from run output", () => {
    const display = buildTaskDetailDisplay(task, [
      run({
        id: "run-1",
        run_type: "pm_orchestration",
        stage: "awaiting_review",
        output: {
          scope: {
            problem: "Agents detail is too thin.",
            approach: "Reuse Forge run rows.",
          },
          events: [
            {
              timestamp: "2026-04-27T10:31:00Z",
              type: "tool_call",
              message: "Read task files",
            },
          ],
        },
      }),
      run({
        id: "run-2",
        run_type: "build",
        stage: "awaiting_review",
        pr_url: "https://github.com/supramal1/CO_OS/pull/42",
        output: {
          submitted_at: "2026-04-27T12:00:00Z",
          pr: { state: "open" },
          summary: {
            tests_run: "npm test",
          },
          markdown: "## Result\n\nDetail restored.",
        },
      }),
    ]);

    expect(display.scopeRows).toEqual([
      ["Problem", "Agents detail is too thin."],
      ["Approach", "Reuse Forge run rows."],
    ]);
    expect(display.pr).toEqual({
      number: 42,
      state: "open",
      url: "https://github.com/supramal1/CO_OS/pull/42",
      label: "supramal1/CO_OS#42",
    });
    expect(display.runs[0].events).toEqual([
      {
        timestamp: "2026-04-27T10:31:00Z",
        type: "tool_call",
        summary: "Read task files",
      },
    ]);
    expect(display.outputs[0]).toMatchObject({
      runId: "run-2",
      kind: "markdown",
      value: "## Result\n\nDetail restored.",
    });
  });

  it("falls back to structured output when no markdown-like value exists", () => {
    const display = buildTaskDetailDisplay(task, [
      run({
        id: "run-1",
        output: {
          summary: { risks: "None" },
          nested: { value: 1 },
        },
      }),
    ]);

    expect(display.outputs).toEqual([
      {
        runId: "run-1",
        runLabel: "Run",
        createdAt: "2026-04-27T10:00:00Z",
        kind: "structured",
        value: {
          summary: { risks: "None" },
          nested: { value: 1 },
        },
      },
    ]);
  });
});

function run(overrides: Partial<ForgeTaskRunRow>): ForgeTaskRunRow {
  return {
    id: "run",
    task_id: "task-1",
    run_type: null,
    stage: null,
    status: "completed",
    actual_cost_usd: null,
    output: null,
    error: null,
    pr_url: null,
    started_at: null,
    completed_at: null,
    created_at: "2026-04-27T10:00:00Z",
    ...overrides,
  };
}
