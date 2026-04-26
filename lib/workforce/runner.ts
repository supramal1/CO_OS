// Workforce runner — the bridge between HTTP routes and the substrate.
//
// Responsibilities:
//   1. Accept a task creation request, mint a Task, return synchronously
//      with taskId + bus URLs while invocation runs in the background.
//   2. Wire the substrate's EventLog onEmit hook to: (a) the SSE bus,
//      (b) the persistence layer (Phase 2 — currently a no-op).
//   3. Track in-flight invocations so /cancel and /status can find them.
//   4. Hold a small in-memory recent-task cache for /tasks list (until
//      Phase 2 lands DB-backed listing).

import {
  createEventLog,
  getAgent,
  invokeAgent,
  newTask,
  validateRoster,
  type EventLogEntry,
  type Task,
  type TaskResult,
} from "@workforce/substrate";
import { publishEnd, publishEvent } from "./bus";
import {
  persistEvent,
  persistTaskCreated,
  persistTaskFinal,
} from "./persistence";
import type {
  CreateTaskRequest,
  InvocationState,
  TaskDetail,
  TaskSummary,
} from "./types";

interface InflightRecord {
  taskId: string;
  agentId: string;
  description: string;
  startedAt: string;
  completedAt?: string;
  state: InvocationState;
  abortController: AbortController;
  result?: TaskResult;
  events: EventLogEntry[];
  parentTaskId?: string;
  error?: { code: string; message: string };
  ownerPrincipalId: string;
  apiKey: string;
}

// In-process registry. Maps every task we've seen this process lifetime
// (running OR completed) to its record. Phase 2 backs this with Postgres so
// the registry survives process restarts.
const REGISTRY = new Map<string, InflightRecord>();

const MAX_RECENT = 100;

export interface RunnerContext {
  principalId: string;
  apiKey: string; // csk_* — Cornerstone per-principal key
  anthropicApiKey: string;
}

export interface StartTaskOutcome {
  taskId: string;
  agentId: string;
  state: InvocationState;
  startedAt: string;
}

export function startTask(
  req: CreateTaskRequest,
  ctx: RunnerContext,
): StartTaskOutcome {
  const agent = getAgent(req.agentId);
  if (!agent) {
    throw new Error(`unknown_agent: '${req.agentId}'`);
  }
  // v0 only allows Lead-rooted invocations; specialists are reachable via
  // delegate_task. This matches the substrate's locked architecture.
  if (!agent.canDelegate) {
    throw new Error(
      `non_lead_invocation: agent '${agent.id}' is not the Lead — invoke through Ada and let her delegate.`,
    );
  }

  const startedAt = new Date().toISOString();
  const task: Task = newTask({
    description: req.description,
    targetWorkspace: req.targetWorkspace ?? agent.defaultWorkspace,
    context: req.context,
    maxCostUsd: req.maxCostUsd,
  });
  const taskId = task.id;

  const abortController = new AbortController();
  const record: InflightRecord = {
    taskId,
    agentId: agent.id,
    description: req.description,
    startedAt,
    state: "running",
    abortController,
    events: [],
    ownerPrincipalId: ctx.principalId,
    apiKey: ctx.apiKey,
  };
  REGISTRY.set(taskId, record);
  trimRegistry();

  // Fire-and-forget persistence — never let a write failure crash the
  // invocation. The persistence layer logs and swallows errors.
  void persistTaskCreated(record);

  const eventLog = createEventLog(
    { taskId, agentId: agent.id },
    (entry) => {
      record.events.push(entry);
      publishEvent(taskId, entry);
      void persistEvent(taskId, entry);
    },
  );

  // Run invocation in the background. The HTTP route returns immediately
  // with the taskId and the SSE URL.
  void runInvocation(record, agent, task, eventLog, ctx);

  return {
    taskId,
    agentId: agent.id,
    state: "running",
    startedAt,
  };
}

async function runInvocation(
  record: InflightRecord,
  agent: ReturnType<typeof getAgent>,
  task: Task,
  eventLog: ReturnType<typeof createEventLog>,
  ctx: RunnerContext,
): Promise<void> {
  if (!agent) return;
  try {
    const result = await invokeAgent(agent, task, {
      anthropicApiKey: ctx.anthropicApiKey,
      cornerstoneApiKey: ctx.apiKey,
      eventLog,
      abortSignal: record.abortController.signal,
    });
    record.result = result;
    record.state = result.status as InvocationState;
    record.completedAt = new Date().toISOString();
    if (result.error) {
      record.error = { code: result.error.code, message: result.error.message };
    }
  } catch (err) {
    record.state = "failed";
    record.completedAt = new Date().toISOString();
    record.error = {
      code: "runner_exception",
      message: err instanceof Error ? err.message : String(err),
    };
  } finally {
    publishEnd(record.taskId, record.state);
    void persistTaskFinal(record);
  }
}

export function cancelTask(taskId: string, principalId: string): boolean {
  const record = REGISTRY.get(taskId);
  if (!record) return false;
  if (record.ownerPrincipalId !== principalId) return false;
  if (record.state !== "running") return true;
  record.abortController.abort();
  record.state = "cancelled";
  record.completedAt = new Date().toISOString();
  return true;
}

export function getTaskDetail(
  taskId: string,
  principalId: string,
): TaskDetail | null {
  const record = REGISTRY.get(taskId);
  if (!record) return null;
  if (record.ownerPrincipalId !== principalId) return null;
  return recordToDetail(record);
}

export function listRecentTasks(principalId: string, limit = 50): TaskSummary[] {
  const all = [...REGISTRY.values()]
    .filter((r) => r.ownerPrincipalId === principalId && !r.parentTaskId)
    .sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1))
    .slice(0, limit);
  return all.map(recordToSummary);
}

export function inflightCount(): number {
  let n = 0;
  for (const r of REGISTRY.values()) if (r.state === "running") n++;
  return n;
}

export function getCachedEvents(taskId: string): EventLogEntry[] {
  const record = REGISTRY.get(taskId);
  return record ? [...record.events] : [];
}

export function isTerminal(taskId: string): boolean {
  const record = REGISTRY.get(taskId);
  if (!record) return true;
  return record.state !== "running";
}

export function rosterStatus() {
  return validateRoster();
}

function recordToSummary(record: InflightRecord): TaskSummary {
  return {
    taskId: record.taskId,
    agentId: record.agentId,
    description: record.description,
    state: record.state,
    startedAt: record.startedAt,
    completedAt: record.completedAt,
    costUsd: record.result?.costUsd ?? 0,
    durationMs: record.result?.durationMs ?? 0,
    parentTaskId: record.parentTaskId,
  };
}

function recordToDetail(record: InflightRecord): TaskDetail {
  const summary = recordToSummary(record);
  const children: TaskSummary[] = (record.result?.children ?? []).map(
    (child) => ({
      taskId: child.taskId,
      agentId: child.agentId,
      description: "",
      state: child.status as InvocationState,
      startedAt: record.startedAt,
      costUsd: child.costUsd,
      durationMs: child.durationMs,
      parentTaskId: record.taskId,
    }),
  );
  return {
    ...summary,
    output: record.result?.output ?? "",
    error: record.error,
    events: record.events.map((e) => ({ ...e })),
    children,
  };
}

function trimRegistry(): void {
  if (REGISTRY.size <= MAX_RECENT * 2) return;
  const sorted = [...REGISTRY.entries()].sort(
    (a, b) => (a[1].startedAt < b[1].startedAt ? -1 : 1),
  );
  while (REGISTRY.size > MAX_RECENT) {
    const [oldestId, record] = sorted.shift()!;
    if (record.state === "running") continue; // never evict in-flight
    REGISTRY.delete(oldestId);
  }
}
