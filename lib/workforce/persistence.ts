// Workforce persistence layer.
//
// Phase 1: stubs that log and swallow — runner attaches them but they no-op
// the DB writes. Phase 2 wires real Supabase inserts here.
//
// Contract: every function must be fire-and-forget safe — never throw, never
// return a rejection. The runner relies on `void` callsites and a single
// failed write must not abort an in-flight invocation.

import type { EventLogEntry } from "@workforce/substrate";

interface InflightLike {
  taskId: string;
  agentId: string;
  description: string;
  startedAt: string;
  completedAt?: string;
  state: string;
  parentTaskId?: string;
  ownerPrincipalId: string;
  result?: {
    output: string;
    costUsd: number;
    durationMs: number;
  };
  error?: { code: string; message: string };
}

export async function persistTaskCreated(_record: InflightLike): Promise<void> {
  // Phase 2: insert into workforce_tasks(id, agent_id, description, state,
  // started_at, principal_id, parent_task_id).
}

export async function persistEvent(
  _taskId: string,
  _entry: EventLogEntry,
): Promise<void> {
  // Phase 2: insert into workforce_task_events(task_id, seq, type, timestamp,
  // agent_id, payload).
}

export async function persistTaskFinal(_record: InflightLike): Promise<void> {
  // Phase 2: update workforce_tasks(state, completed_at, error_*) +
  // upsert workforce_task_results(task_id, output, cost_usd, duration_ms).
}
