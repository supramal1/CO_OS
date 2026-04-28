export type ForgeActiveRunRow = {
  id: string;
  task_id: string;
  status: string | null;
  run_type: string | null;
  stage?: string | null;
  agent_role?: string | null;
  started_at: string | null;
  created_at: string;
};

export type AgentActiveStatus =
  | { active: false }
  | {
      active: true;
      taskId: string;
      runId: string;
      label: string;
      workerLabel: string;
      runLabel: string;
      startedAt: string | null;
    };

export function activeStatusForTask(
  rows: readonly ForgeActiveRunRow[],
  taskId: string,
): AgentActiveStatus {
  const latest = latestRunningRun(rows, taskId);
  if (!latest) return { active: false };

  const runLabel = humanizeLabel(latest.run_type) || "Run";
  const workerLabel = humanizeLabel(latest.agent_role) || runLabel || "Agent";
  return {
    active: true,
    taskId,
    runId: latest.id,
    label: `${workerLabel} working`,
    workerLabel,
    runLabel,
    startedAt: latest.started_at ?? latest.created_at ?? null,
  };
}

export function activeStatusMap(
  rows: readonly ForgeActiveRunRow[],
  taskIds: readonly string[],
): Map<string, Extract<AgentActiveStatus, { active: true }>> {
  const result = new Map<string, Extract<AgentActiveStatus, { active: true }>>();
  for (const taskId of taskIds) {
    const status = activeStatusForTask(rows, taskId);
    if (status.active) result.set(taskId, status);
  }
  return result;
}

function latestRunningRun(
  rows: readonly ForgeActiveRunRow[],
  taskId: string,
): ForgeActiveRunRow | null {
  let latest: ForgeActiveRunRow | null = null;
  for (const row of rows) {
    if (row.task_id !== taskId || row.status !== "running") continue;
    if (!latest || runTimestamp(row) > runTimestamp(latest)) latest = row;
  }
  return latest;
}

function runTimestamp(row: ForgeActiveRunRow): string {
  return row.started_at ?? row.created_at ?? "";
}

function humanizeLabel(value: string | null | undefined): string {
  if (!value) return "";
  return value
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((part, index) => {
      const lower = part.toLowerCase();
      if (ACRONYMS.has(lower)) return lower.toUpperCase();
      if (index === 0) return capitalise(lower);
      return lower;
    })
    .join(" ");
}

function capitalise(value: string): string {
  return value ? `${value[0].toUpperCase()}${value.slice(1)}` : "";
}

const ACRONYMS = new Set(["api", "pm", "pr", "qa", "ui", "ux"]);
