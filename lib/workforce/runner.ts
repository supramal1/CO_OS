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
  getRoster,
  invokeAgent,
  newTask,
  validateRoster,
  type EventLogEntry,
  type Task,
  type TaskResult,
} from "@workforce/substrate";
import { publishEnd, publishEvent } from "./bus";
import {
  fetchEvents,
  fetchRecentTasks,
  fetchResult,
  fetchTask,
  persistChildTaskFromEvent,
  persistEvent,
  persistTaskCreated,
  persistTaskFinal,
  persistTaskResultRecursively,
  type PersistedEventRow,
  type PersistedResultRow,
  type PersistedTaskRow,
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
  parentAgentId?: string;
  targetWorkspace?: string;
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
    targetWorkspace: req.targetWorkspace ?? agent.defaultWorkspace,
    ownerPrincipalId: ctx.principalId,
    apiKey: ctx.apiKey,
  };
  REGISTRY.set(taskId, record);
  trimRegistry();

  // Per-runner write chain: serialises persistence writes so that
  //   1. the parent task row is committed BEFORE its task_started event
  //      (otherwise the FK on workforce_task_events.task_id violates), and
  //   2. each child task row is committed BEFORE its first event
  //      (children spawned via delegate_task fire task_started through the
  //      same EventLog.onEmit hook — without this, every child event
  //      silently FK-fails and is lost from the DB).
  // The chain is per-startTask because cross-task ordering doesn't matter;
  // only intra-task ordering does.
  const persistedTasks = new Set<string>([taskId]);
  let writeChain: Promise<void> = persistTaskCreated(record);

  const eventLog = createEventLog(
    { taskId, agentId: agent.id },
    (entry) => {
      record.events.push(entry);
      // Bus channels are keyed by the entry's own taskId so a child's
      // detail page (if Mal navigates to /workforce/tasks/<child>) can
      // get its own SSE stream — the parent's stream still receives all
      // descendant events because the substrate routes them through the
      // shared EventLog.
      publishEvent(entry.taskId, entry);
      if (entry.taskId !== taskId) publishEvent(taskId, entry);

      writeChain = writeChain.then(async () => {
        if (!persistedTasks.has(entry.taskId) && entry.type === "task_started") {
          persistedTasks.add(entry.taskId);
          await persistChildTaskFromEvent(entry, ctx.principalId);
        }
        await persistEvent(entry.taskId, entry);
      });
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
      roster: getRoster(),
      depth: 0,
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
    if (record.result) {
      // Walk the substrate's children tree and persist each child's final
      // state + output. Children's task rows were inserted lazily by the
      // event-log hook above; this populates their cost/duration/output
      // (the actual delegated agent's report) into workforce_task_results
      // so the UI can render it on the child's detail page.
      void persistTaskResultRecursively(record.result);
    }
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

export async function getTaskDetail(
  taskId: string,
  principalId: string,
): Promise<TaskDetail | null> {
  const record = REGISTRY.get(taskId);
  if (record) {
    if (record.ownerPrincipalId !== principalId) return null;
    return recordToDetail(record);
  }
  // Process restart / older task — read from Supabase.
  const row = await fetchTask(taskId, principalId);
  if (!row) return null;
  const [result, events] = await Promise.all([
    fetchResult(taskId),
    fetchEvents(taskId),
  ]);
  return rowToDetail(row, result, events);
}

export async function listRecentTasks(
  principalId: string,
  limit = 50,
): Promise<TaskSummary[]> {
  const inMemory = [...REGISTRY.values()]
    .filter((r) => r.ownerPrincipalId === principalId && !r.parentTaskId)
    .map(recordToSummary);
  const inMemoryIds = new Set(inMemory.map((s) => s.taskId));
  const persisted = await fetchRecentTasks(principalId, limit);
  const merged: TaskSummary[] = [...inMemory];
  for (const row of persisted) {
    if (inMemoryIds.has(row.id)) continue;
    merged.push(rowToSummary(row));
  }
  return merged
    .sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1))
    .slice(0, limit);
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

function rowToSummary(row: PersistedTaskRow): TaskSummary {
  return {
    taskId: row.id,
    agentId: row.agent_id,
    description: row.description,
    state: row.state as InvocationState,
    startedAt: row.started_at,
    completedAt: row.completed_at ?? undefined,
    costUsd: Number(row.cost_usd ?? 0),
    durationMs: row.duration_ms ?? 0,
    parentTaskId: row.parent_task_id ?? undefined,
  };
}

function rowToDetail(
  row: PersistedTaskRow,
  result: PersistedResultRow | null,
  events: PersistedEventRow[],
): TaskDetail {
  const summary = rowToSummary(row);
  return {
    ...summary,
    output: result?.output ?? "",
    error: row.error ?? undefined,
    events: events.map((e) => ({
      type: e.type as EventLogEntry["type"],
      timestamp: e.timestamp,
      seq: e.seq,
      taskId: e.task_id,
      agentId: e.agent_id,
      payload: e.payload,
    })),
    children: [],
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
