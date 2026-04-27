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
import { makeApprovalHook } from "./approvals";
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
declare global {
  // eslint-disable-next-line no-var
  var __wf_registry: Map<string, InflightRecord> | undefined;
}

const REGISTRY: Map<string, InflightRecord> =
  (globalThis.__wf_registry ??= new Map());

const MAX_RECENT = 100;

export interface RunnerContext {
  principalId: string;
  apiKey: string; // csk_* — Cornerstone per-principal key
  anthropicApiKey: string;
  /**
   * Cornerstone API base URL. Falls back inside the substrate to
   * process.env.CORNERSTONE_API_URL → DEFAULT_CORNERSTONE_API_BASE_URL when
   * undefined, but threading it explicitly here lets the route layer point a
   * task at staging / a local Cornerstone without mutating env globally.
   */
  cornerstoneApiBaseUrl?: string;
  /** Grace's GitHub PAT — required for github_* tools. */
  graceGithubPat?: string;
  /** Grace's GitHub org. Defaults to "Forgeautomatedrepo" inside the substrate. */
  graceGithubOrg?: string;
  /** Grace's branch-namespace prefix. Defaults to "grace/" inside the substrate. */
  graceGithubBranchPrefix?: string;
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
  void runInvocation(record, agent, task, eventLog, ctx, () => writeChain);

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
  flushEventWrites: () => Promise<void>,
): Promise<void> {
  if (!agent) return;
  // Bind one approval hook per top-level task. The hook closes over the
  // owner's principal so approve/reject endpoints can authorise resolution
  // back to the same operator that started the task. agentId tracks the
  // *invoking* agent on the parent invocation; tools running deeper in the
  // delegation tree still get this same hook (substrate's child invoker
  // spreads ...options) and the substrate writes the per-call agentId on
  // the resulting `approval_requested` event for the inbox to display.
  const requestApproval = makeApprovalHook({
    taskId: record.taskId,
    agentId: agent.id,
    ownerPrincipalId: record.ownerPrincipalId,
  });
  try {
    const result = await invokeAgent(agent, task, {
      anthropicApiKey: ctx.anthropicApiKey,
      cornerstoneApiKey: ctx.apiKey,
      cornerstoneApiBaseUrl: ctx.cornerstoneApiBaseUrl,
      graceGithubPat: ctx.graceGithubPat,
      graceGithubOrg: ctx.graceGithubOrg,
      graceGithubBranchPrefix: ctx.graceGithubBranchPrefix,
      eventLog,
      abortSignal: record.abortController.signal,
      roster: getRoster(),
      depth: 0,
      requestApproval,
    });
    record.result = result;
    record.state = result.status as InvocationState;
    record.completedAt = new Date().toISOString();
    if (result.error) {
      record.error = { code: result.error.code, message: result.error.message };
    }
  } catch (err) {
    record.state = record.abortController.signal.aborted ? "cancelled" : "failed";
    record.completedAt = new Date().toISOString();
    record.error = {
      code:
        record.state === "cancelled" ? "cancelled" : "runner_exception",
      message:
        record.state === "cancelled"
          ? "Task cancelled."
          : err instanceof Error
            ? err.message
            : String(err),
    };
  } finally {
    await flushEventWrites();
    await persistTaskFinal(record);
    if (record.result) {
      // Walk the substrate's children tree and persist each child's final
      // state + output. Children's task rows were inserted lazily by the
      // event-log hook above; this populates their cost/duration/output
      // (the actual delegated agent's report) into workforce_task_results
      // so the UI can render it on the child's detail page.
      await persistTaskResultRecursively(record.result);
    }
    publishEnd(record.taskId, record.state);
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
  // Children spawned via delegate_task aren't separate REGISTRY entries
  // — they run inline within the parent's invocation and share its
  // event log. Walk each running parent's events to surface any active
  // child tasks (task_started without a matching task_completed) so
  // the pixel office can light up the delegate's sprite. The rail
  // filters parentTaskId on the client so synthesised children don't
  // clutter the recent list.
  const inMemoryChildren: TaskSummary[] = [];
  for (const record of REGISTRY.values()) {
    if (record.ownerPrincipalId !== principalId) continue;
    if (record.parentTaskId) continue;
    if (record.state !== "running") continue;
    inMemoryChildren.push(...synthesiseChildSummaries(record));
  }
  const inMemoryIds = new Set(inMemory.map((s) => s.taskId));
  const childIds = new Set(inMemoryChildren.map((s) => s.taskId));
  const persisted = await fetchRecentTasks(principalId, limit);
  const merged: TaskSummary[] = [...inMemory, ...inMemoryChildren];
  for (const row of persisted) {
    if (inMemoryIds.has(row.id) || childIds.has(row.id)) continue;
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
  let toolCalledCount = 0;
  let toolReturnedCount = 0;
  let latestToolCalled: string | undefined;
  const costUsd = record.result?.totalCostUsd ?? record.result?.costUsd ?? 0;
  for (const e of record.events) {
    if (e.type === "tool_called") {
      toolCalledCount++;
      const tn = (e.payload as { toolName?: string }).toolName;
      if (typeof tn === "string") latestToolCalled = tn;
    } else if (e.type === "tool_returned") {
      toolReturnedCount++;
    }
  }
  return {
    taskId: record.taskId,
    agentId: record.agentId,
    description: record.description,
    state: record.state,
    startedAt: record.startedAt,
    completedAt: record.completedAt,
    costUsd,
    totalCostUsd: costUsd,
    durationMs: record.result?.durationMs ?? 0,
    parentTaskId: record.parentTaskId,
    currentTool:
      record.state === "running" ? currentToolForRecord(record) : undefined,
    _debug: {
      inMemory: true,
      eventCount: record.events.length,
      toolCalledCount,
      toolReturnedCount,
      latestToolCalled,
    },
  };
}

// Walks the parent record's shared event log to surface any active
// child tasks (delegate spawns whose task_started fired but whose
// matching task_completed/task_failed/task_cancelled hasn't). Each
// active child becomes a synthesised TaskSummary in "running" state
// so the office can put the delegate's sprite into working / at_station.
//
// currentTool is computed by filtering the parent's events to the
// child's taskId — same algorithm as currentToolForRecord but scoped
// to a single delegate's frame.
function synthesiseChildSummaries(record: InflightRecord): TaskSummary[] {
  const childStarts = new Map<string, EventLogEntry>();
  const finished = new Set<string>();
  for (const e of record.events) {
    if (e.taskId === record.taskId) continue;
    if (e.type === "task_started") {
      childStarts.set(e.taskId, e);
    } else if (
      e.type === "task_completed" ||
      e.type === "task_failed" ||
      e.type === "task_cancelled"
    ) {
      finished.add(e.taskId);
    }
  }
  const summaries: TaskSummary[] = [];
  for (const [childTaskId, startEvent] of childStarts) {
    if (finished.has(childTaskId)) continue;
    const childEvents = record.events.filter((e) => e.taskId === childTaskId);
    summaries.push({
      taskId: childTaskId,
      agentId: startEvent.agentId,
      description:
        (startEvent.payload as { description?: string }).description ?? "",
      state: "running",
      startedAt: startEvent.timestamp,
      costUsd: 0,
      totalCostUsd: 0,
      durationMs: 0,
      parentTaskId: record.taskId,
      currentTool: currentToolForEvents(childEvents),
    });
  }
  return summaries;
}

// Same logic as currentToolForRecord but operating on a pre-filtered
// event slice. Used by synthesiseChildSummaries to scope tool tracking
// to a single delegate frame within the shared event log.
function currentToolForEvents(
  events: EventLogEntry[],
): { name: string; agentId: string } | undefined {
  const returned = new Set<string>();
  for (const e of events) {
    if (e.type === "tool_returned") {
      const id = (e.payload as { toolUseId?: string }).toolUseId;
      if (id) returned.add(id);
    }
  }
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (e.type !== "tool_called") continue;
    const payload = e.payload as { toolUseId?: string; toolName?: string };
    if (payload.toolUseId && returned.has(payload.toolUseId)) continue;
    if (typeof payload.toolName === "string") {
      return { name: payload.toolName, agentId: e.agentId };
    }
  }
  return undefined;
}

// Walks the cached events for the latest tool_called whose toolUseId
// has not yet appeared in a tool_returned. That's the tool somebody
// in the task tree is "in" right now. Returns undefined if no tool
// is in-flight.
//
// We carry the agentId from the event itself, not the record's lead,
// because parent + delegate share one EventLog: when Ada delegates a
// web_search to Margaret, the tool_called event has agentId="margaret"
// even though it lives on Ada's record. The office uses that agentId
// to walk the right sprite.
function currentToolForRecord(
  record: InflightRecord,
): { name: string; agentId: string } | undefined {
  const returned = new Set<string>();
  for (const e of record.events) {
    if (e.type === "tool_returned") {
      const id = (e.payload as { toolUseId?: string }).toolUseId;
      if (id) returned.add(id);
    }
  }
  for (let i = record.events.length - 1; i >= 0; i--) {
    const e = record.events[i];
    if (e.type !== "tool_called") continue;
    const payload = e.payload as { toolUseId?: string; toolName?: string };
    if (payload.toolUseId && returned.has(payload.toolUseId)) continue;
    if (typeof payload.toolName === "string") {
      return { name: payload.toolName, agentId: e.agentId };
    }
  }
  return undefined;
}

function recordToDetail(record: InflightRecord): TaskDetail {
  const summary = recordToSummary(record);
  const children: TaskSummary[] = (record.result?.children ?? []).map(
    (child) => {
      const childCostUsd = child.totalCostUsd ?? child.costUsd;
      return {
        taskId: child.taskId,
        agentId: child.agentId,
        description: "",
        state: child.status as InvocationState,
        startedAt: record.startedAt,
        costUsd: childCostUsd,
        totalCostUsd: childCostUsd,
        durationMs: child.durationMs,
        parentTaskId: record.taskId,
      };
    },
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
    totalCostUsd: Number(row.cost_usd ?? 0),
    durationMs: row.duration_ms ?? 0,
    parentTaskId: row.parent_task_id ?? undefined,
    _debug: {
      inMemory: false,
      eventCount: 0,
      toolCalledCount: 0,
      toolReturnedCount: 0,
    },
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
