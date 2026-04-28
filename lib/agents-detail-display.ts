import type { ForgeTask } from "@/lib/agents-types";

export type ForgeTaskRunRow = {
  id: string;
  task_id: string;
  run_type: string | null;
  stage: string | null;
  status: string | null;
  actual_cost_usd: string | number | null;
  output: unknown;
  error: string | null;
  pr_url: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
};

export type DisplayEvent = {
  timestamp: string | null;
  type: string;
  summary: string;
};

export type DisplayOutput = {
  runId: string;
  runLabel: string;
  createdAt: string;
  kind: "markdown" | "structured";
  value: string | Record<string, unknown>;
};

export type DisplayRun = {
  id: string;
  label: string;
  stageLabel: string;
  statusLabel: string;
  costUsd: number | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  error: string | null;
  events: DisplayEvent[];
};

export type DisplayPrContext = {
  number: number | null;
  state: string;
  url: string;
  label: string;
};

export type TaskDetailDisplay = {
  runs: DisplayRun[];
  outputs: DisplayOutput[];
  scopeRows: Array<[string, string]>;
  pr: DisplayPrContext | null;
};

type ScopeShape = Partial<Record<"problem" | "approach" | "risks" | "open_questions" | "estimated_effort", unknown>>;

const SCOPE_LABELS: Array<[keyof ScopeShape, string]> = [
  ["problem", "Problem"],
  ["approach", "Approach"],
  ["risks", "Risks"],
  ["open_questions", "Open questions"],
  ["estimated_effort", "Estimated effort"],
];

const NON_OUTPUT_KEYS = new Set([
  "events",
  "event_log",
  "logs",
  "scope",
  "submitted_at",
]);

export function buildTaskDetailDisplay(
  task: ForgeTask,
  rows: ForgeTaskRunRow[],
): TaskDetailDisplay {
  const runs = [...rows].sort(compareRunCreatedAt);
  return {
    runs: runs.map(toDisplayRun),
    outputs: runs.flatMap(toDisplayOutput),
    scopeRows: buildScopeRows(task, runs),
    pr: buildPrContext(task, runs),
  };
}

function toDisplayRun(row: ForgeTaskRunRow): DisplayRun {
  return {
    id: row.id,
    label: humanize(row.run_type) || "Run",
    stageLabel: humanize(row.stage) || "No stage",
    statusLabel: humanize(row.status) || "Unknown",
    costUsd: parseCost(row.actual_cost_usd),
    createdAt: row.created_at,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    error: row.error,
    events: extractEvents(row),
  };
}

function toDisplayOutput(row: ForgeTaskRunRow): DisplayOutput[] {
  const output = row.output;
  if (typeof output === "string" && output.trim()) {
    return [
      {
        runId: row.id,
        runLabel: humanize(row.run_type) || "Run",
        createdAt: row.created_at,
        kind: "markdown",
        value: output,
      },
    ];
  }

  if (!isRecord(output)) return [];

  const markdown = firstStringValue(output, [
    "markdown",
    "final_output",
    "output",
    "result",
    "report",
    "body",
  ]);
  if (markdown) {
    return [
      {
        runId: row.id,
        runLabel: humanize(row.run_type) || "Run",
        createdAt: row.created_at,
        kind: "markdown",
        value: markdown,
      },
    ];
  }

  const displayable = stripOperationalKeys(output);
  if (Object.keys(displayable).length === 0) return [];

  return [
    {
      runId: row.id,
      runLabel: humanize(row.run_type) || "Run",
      createdAt: row.created_at,
      kind: "structured",
      value: displayable,
    },
  ];
}

function buildScopeRows(
  task: ForgeTask,
  runs: ForgeTaskRunRow[],
): Array<[string, string]> {
  const scope = latestScope(runs) ?? scopeFromMetadata(task.metadata);
  const rows: Array<[string, string]> = [];
  if (scope) {
    for (const [key, label] of SCOPE_LABELS) {
      const value = stringifyDisplayValue(scope[key]);
      if (value) rows.push([label, value]);
    }
  }
  if (rows.length === 0 && task.description) {
    rows.push(["Brief", task.description]);
  }
  return rows;
}

function buildPrContext(
  task: ForgeTask,
  runs: ForgeTaskRunRow[],
): DisplayPrContext | null {
  for (let i = runs.length - 1; i >= 0; i -= 1) {
    const row = runs[i];
    const url = row.pr_url ?? stringFromPath(row.output, ["pr_url"]);
    if (!url) continue;
    const parsed = parseGithubPrUrl(url);
    const state =
      stringFromPath(row.output, ["pr", "state"]) ??
      stringFromPath(row.output, ["pr_state"]) ??
      stringMetadata(task.metadata, "pr_state") ??
      "unknown";
    return {
      number: parsed?.number ?? null,
      state,
      url,
      label: parsed ? `${parsed.owner}/${parsed.repo}#${parsed.number}` : url,
    };
  }
  return null;
}

function latestScope(runs: ForgeTaskRunRow[]): ScopeShape | null {
  for (let i = runs.length - 1; i >= 0; i -= 1) {
    const output = runs[i].output;
    if (isRecord(output) && isRecord(output.scope)) return output.scope as ScopeShape;
  }
  return null;
}

function scopeFromMetadata(metadata: ForgeTask["metadata"]): ScopeShape | null {
  if (!metadata) return null;
  if (isRecord(metadata.scope)) return metadata.scope as ScopeShape;
  return metadata as ScopeShape;
}

function extractEvents(row: ForgeTaskRunRow): DisplayEvent[] {
  if (!isRecord(row.output)) return [];
  const source =
    arrayFromKey(row.output, "events") ??
    arrayFromKey(row.output, "event_log") ??
    arrayFromKey(row.output, "logs") ??
    [];
  return source.map((entry) => normalizeEvent(entry, row.created_at));
}

function normalizeEvent(entry: unknown, fallbackTimestamp: string): DisplayEvent {
  if (typeof entry === "string") {
    return { timestamp: fallbackTimestamp, type: "log", summary: entry };
  }
  if (!isRecord(entry)) {
    return {
      timestamp: fallbackTimestamp,
      type: "event",
      summary: stringifyDisplayValue(entry) || "Event recorded",
    };
  }
  const type =
    firstStringValue(entry, ["type", "event", "kind", "level", "name"]) ??
    "event";
  const timestamp =
    firstStringValue(entry, ["timestamp", "created_at", "time", "ts"]) ??
    fallbackTimestamp;
  const summary =
    firstStringValue(entry, ["message", "summary", "text", "title"]) ??
    stringifyDisplayValue(entry.payload) ??
    stringifyDisplayValue(entry) ??
    "Event recorded";
  return { timestamp, type, summary };
}

function compareRunCreatedAt(a: ForgeTaskRunRow, b: ForgeTaskRunRow): number {
  return a.created_at.localeCompare(b.created_at);
}

function parseCost(value: string | number | null): number | null {
  if (value == null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function humanize(value: string | null): string {
  if (!value) return "";
  return value
    .split("_")
    .filter(Boolean)
    .map((part, index) =>
      part.toLowerCase() === "pm"
        ? "PM"
        : index === 0
          ? part.charAt(0).toUpperCase() + part.slice(1)
          : part.toLowerCase(),
    )
    .join(" ");
}

function stripOperationalKeys(input: Record<string, unknown>): Record<string, unknown> {
  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (!NON_OUTPUT_KEYS.has(key)) output[key] = value;
  }
  return output;
}

function firstStringValue(
  input: Record<string, unknown>,
  keys: string[],
): string | null {
  for (const key of keys) {
    const value = input[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  return null;
}

function stringMetadata(
  metadata: ForgeTask["metadata"],
  key: string,
): string | null {
  if (!metadata) return null;
  const value = metadata[key];
  return typeof value === "string" && value.trim() ? value : null;
}

function stringFromPath(input: unknown, path: string[]): string | null {
  let cursor = input;
  for (const part of path) {
    if (!isRecord(cursor)) return null;
    cursor = cursor[part];
  }
  return typeof cursor === "string" && cursor.trim() ? cursor : null;
}

function arrayFromKey(
  input: Record<string, unknown>,
  key: string,
): unknown[] | null {
  const value = input[key];
  return Array.isArray(value) ? value : null;
}

function parseGithubPrUrl(
  url: string,
): { owner: string; repo: string; number: number } | null {
  const match = url.match(/^https:\/\/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/);
  if (!match) return null;
  return { owner: match[1], repo: match[2], number: Number(match[3]) };
}

function stringifyDisplayValue(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === "string") return value.trim() || null;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
