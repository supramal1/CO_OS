#!/usr/bin/env node
// CLI entry point for @co/workforce-substrate v0.
//
// Usage:
//   npx tsx bin/invoke.ts <agentName> "<task description>" [--flags]
//
// Flags:
//   --target-workspace=<ws>   Force Cornerstone workspace for the task tree.
//   --max-cost=<dollars>      Soft budget hint (logged, not yet enforced).
//   --output=json|text        Output format (default: text).
//   --debug                   Stream the event log to stderr.
//   --max-turns=<n>           Override max model turns (default 16).
//
// Env:
//   ANTHROPIC_API_KEY         Required.
//   MEMORY_API_KEY            Required for Cornerstone-touching agents.
//   CORNERSTONE_API_URL       Optional override.
//   COOKBOOK_MCP_URL          Optional override.

import {
  AI_OPS_WORKSPACE,
  invokeAgent,
  newTask,
  type EventLogEntry,
  type TaskResult,
} from "../src/index.js";
import { getAgent, getRoster, validateRoster } from "../src/roster.js";
import { createEventLog } from "../src/event-log.js";

interface ParsedCli {
  agentName: string;
  task: string;
  targetWorkspace?: string;
  maxCostUsd?: number;
  output: "json" | "text";
  debug: boolean;
  maxTurns?: number;
}

function parseCli(argv: readonly string[]): ParsedCli | { help: true } | { error: string } {
  const positional: string[] = [];
  let targetWorkspace: string | undefined;
  let maxCostUsd: number | undefined;
  let output: "json" | "text" = "text";
  let debug = false;
  let maxTurns: number | undefined;

  for (const raw of argv) {
    if (raw === "-h" || raw === "--help") return { help: true };
    if (raw === "--debug") {
      debug = true;
      continue;
    }
    if (raw.startsWith("--target-workspace=")) {
      targetWorkspace = raw.slice("--target-workspace=".length);
      continue;
    }
    if (raw.startsWith("--max-cost=")) {
      const n = Number(raw.slice("--max-cost=".length));
      if (!Number.isFinite(n) || n <= 0) {
        return { error: `--max-cost expects a positive number; got '${raw}'.` };
      }
      maxCostUsd = n;
      continue;
    }
    if (raw.startsWith("--output=")) {
      const v = raw.slice("--output=".length);
      if (v !== "json" && v !== "text") {
        return { error: `--output must be 'json' or 'text'; got '${v}'.` };
      }
      output = v;
      continue;
    }
    if (raw.startsWith("--max-turns=")) {
      const n = Number(raw.slice("--max-turns=".length));
      if (!Number.isInteger(n) || n <= 0) {
        return { error: `--max-turns expects a positive integer; got '${raw}'.` };
      }
      maxTurns = n;
      continue;
    }
    if (raw.startsWith("--")) {
      return { error: `Unknown flag '${raw}'. Try --help.` };
    }
    positional.push(raw);
  }

  if (positional.length < 2) {
    return { error: "Expected: <agentName> \"<task description>\". Try --help." };
  }
  const [agentName, ...taskParts] = positional;
  const task = taskParts.join(" ").trim();
  if (!task) return { error: "Task description is empty." };

  return {
    agentName: agentName!,
    task,
    targetWorkspace,
    maxCostUsd,
    output,
    debug,
    maxTurns,
  };
}

function printHelp(): void {
  process.stdout.write(
    [
      "Usage: tsx bin/invoke.ts <agentName> \"<task>\" [flags]",
      "",
      "Agents (v0 roster):",
      "  ada       Lead — delegates everything",
      "  alan      Architect specialist",
      "  grace     Implementer (no real coding tools yet)",
      "  margaret  Researcher (web_search only)",
      "  donald    Scribe + Cornerstone hygiene (steward family)",
      "",
      "Flags:",
      "  --target-workspace=<ws>   Force Cornerstone workspace",
      "  --max-cost=<dollars>      Soft budget hint",
      "  --output=json|text        Output format (default: text)",
      "  --debug                   Stream event log to stderr",
      "  --max-turns=<n>           Override max model turns",
      "  -h, --help                Show this message",
      "",
      "Required env: ANTHROPIC_API_KEY, MEMORY_API_KEY (Cornerstone csk_*).",
      "",
    ].join("\n"),
  );
}

function streamEntryToStderr(entry: EventLogEntry): void {
  const tag = `[${entry.seq.toString().padStart(3, "0")} ${entry.type}]`;
  const meta: Record<string, unknown> = { ...entry.payload };
  meta["agent"] = entry.agentId;
  meta["task"] = entry.taskId.slice(0, 8);
  process.stderr.write(`${tag} ${JSON.stringify(meta)}\n`);
}

function renderTextResult(result: TaskResult, debug: boolean): string {
  const lines: string[] = [];
  lines.push(`status:    ${result.status}`);
  lines.push(`agent:     ${result.agentId}`);
  lines.push(`task:      ${result.taskId}`);
  lines.push(`cost:      $${result.totalCostUsd.toFixed(6)}`);
  if (result.totalCostUsd !== result.costUsd) {
    lines.push(`parent:    $${result.costUsd.toFixed(6)}`);
  }
  lines.push(`duration:  ${result.durationMs}ms`);
  if (result.error) {
    lines.push(`error:     ${result.error.code} — ${result.error.message}`);
  }
  if (result.children.length > 0) {
    lines.push(`children:  ${result.children.length} subordinate task(s)`);
    for (const child of result.children) {
      lines.push(
        `  - ${child.agentId} (${child.status}, $${child.totalCostUsd.toFixed(6)}, ${child.durationMs}ms)`,
      );
    }
  }
  lines.push("");
  lines.push("--- output ---");
  lines.push(result.output || "(empty)");
  if (debug) {
    lines.push("");
    lines.push("--- event log ---");
    for (const e of result.eventLog) {
      lines.push(
        `  #${e.seq} ${e.type} agent=${e.agentId} task=${e.taskId.slice(0, 8)} ${JSON.stringify(e.payload)}`,
      );
    }
  }
  return lines.join("\n");
}

async function main(): Promise<number> {
  const parsed = parseCli(process.argv.slice(2));
  if ("help" in parsed) {
    printHelp();
    return 0;
  }
  if ("error" in parsed) {
    process.stderr.write(`error: ${parsed.error}\n`);
    printHelp();
    return 2;
  }

  // Validate the roster up front — fail fast on misconfiguration.
  const validation = validateRoster();
  if (!validation.ok) {
    process.stderr.write("Roster validation failed:\n");
    for (const e of validation.errors) {
      process.stderr.write(`  ${e.code}: ${e.message}\n`);
    }
    return 3;
  }

  const agent = getAgent(parsed.agentName);
  if (!agent) {
    process.stderr.write(
      `error: no agent matching '${parsed.agentName}' in the v0 roster. Available: ada, alan, grace, margaret, donald.\n`,
    );
    return 2;
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    process.stderr.write("error: ANTHROPIC_API_KEY env var is required.\n");
    return 2;
  }

  if (
    (agent.canUseCornerstoneRead || agent.canUseCornerstoneWrite) &&
    !process.env.CORNERSTONE_API_KEY &&
    !process.env.MEMORY_API_KEY
  ) {
    process.stderr.write(
      `error: agent '${agent.id}' uses Cornerstone — set CORNERSTONE_API_KEY (csk_*) or MEMORY_API_KEY.\n`,
    );
    return 2;
  }

  // Build the Task. targetWorkspace falls back to the agent's default
  // workspace (aiops) — the substrate enforces the write-namespace at
  // dispatch time even if the model supplies a namespace argument.
  const task = newTask({
    description: parsed.task,
    targetWorkspace: parsed.targetWorkspace ?? agent.defaultWorkspace ?? AI_OPS_WORKSPACE,
    maxCostUsd: parsed.maxCostUsd,
  });

  const eventLog = createEventLog(
    { taskId: task.id, agentId: agent.id },
    parsed.debug ? streamEntryToStderr : undefined,
  );

  const controller = new AbortController();
  const sigHandler = () => {
    process.stderr.write("\nReceived interrupt — cancelling agent run...\n");
    controller.abort();
  };
  process.once("SIGINT", sigHandler);
  process.once("SIGTERM", sigHandler);

  let result: TaskResult;
  try {
    result = await invokeAgent(agent, task, {
      eventLog,
      roster: getRoster(),
      depth: 0,
      abortSignal: controller.signal,
      maxTurns: parsed.maxTurns,
    });
  } catch (err) {
    process.stderr.write(
      `unexpected runtime exception: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    return 1;
  } finally {
    process.removeListener("SIGINT", sigHandler);
    process.removeListener("SIGTERM", sigHandler);
  }

  if (parsed.output === "json") {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } else {
    process.stdout.write(`${renderTextResult(result, parsed.debug)}\n`);
  }

  // Exit codes: 0 = completed, 4 = blocked, 5 = rejected, 6 = cancelled, 1 = failed.
  switch (result.status) {
    case "completed":
      return 0;
    case "blocked":
      return 4;
    case "rejected":
      return 5;
    case "cancelled":
      return 6;
    case "failed":
    default:
      return 1;
  }
}

main().then(
  (code) => {
    process.exit(code);
  },
  (err) => {
    process.stderr.write(
      `fatal: ${err instanceof Error ? err.stack ?? err.message : String(err)}\n`,
    );
    process.exit(1);
  },
);
