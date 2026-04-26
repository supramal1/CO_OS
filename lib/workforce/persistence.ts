// Workforce persistence layer — Supabase writes for the task ledger.
//
// Contract: every function is fire-and-forget safe. We never throw. A
// failed insert is logged and swallowed so the substrate's synchronous
// invocation is unaffected. If the service-role key is missing we
// silently no-op — the in-memory registry in runner.ts keeps the system
// dogfood-able.

import type { EventLogEntry } from "@workforce/substrate";
import { getWorkforceSupabase } from "./supabase";

interface InflightLike {
  taskId: string;
  agentId: string;
  description: string;
  startedAt: string;
  completedAt?: string;
  state: string;
  parentTaskId?: string;
  parentAgentId?: string;
  ownerPrincipalId: string;
  targetWorkspace?: string;
  result?: {
    output: string;
    costUsd: number;
    durationMs: number;
  };
  error?: { code: string; message: string };
}

export async function persistTaskCreated(record: InflightLike): Promise<void> {
  const sb = getWorkforceSupabase();
  if (!sb) return;
  try {
    const { error } = await sb.from("workforce_tasks").insert({
      id: record.taskId,
      agent_id: record.agentId,
      description: record.description,
      target_workspace: record.targetWorkspace ?? null,
      parent_task_id: record.parentTaskId ?? null,
      parent_agent_id: record.parentAgentId ?? null,
      state: record.state,
      principal_id: record.ownerPrincipalId,
      started_at: record.startedAt,
    });
    if (error) console.warn("[workforce] persistTaskCreated failed:", error.message);
  } catch (err) {
    console.warn("[workforce] persistTaskCreated threw:", String(err));
  }
}

export async function persistEvent(
  taskId: string,
  entry: EventLogEntry,
): Promise<void> {
  const sb = getWorkforceSupabase();
  if (!sb) return;
  try {
    const { error } = await sb.from("workforce_task_events").insert({
      task_id: taskId,
      seq: entry.seq,
      type: entry.type,
      timestamp: entry.timestamp,
      agent_id: entry.agentId,
      payload: entry.payload as object,
    });
    // Duplicate-key errors (PK on task_id+seq) can happen on rare retries —
    // they're benign for an append-only log.
    if (error && error.code !== "23505") {
      console.warn("[workforce] persistEvent failed:", error.message);
    }
  } catch (err) {
    console.warn("[workforce] persistEvent threw:", String(err));
  }
}

export async function persistTaskFinal(record: InflightLike): Promise<void> {
  const sb = getWorkforceSupabase();
  if (!sb) return;
  try {
    const { error: updateErr } = await sb
      .from("workforce_tasks")
      .update({
        state: record.state,
        completed_at: record.completedAt ?? new Date().toISOString(),
        cost_usd: record.result?.costUsd ?? 0,
        duration_ms: record.result?.durationMs ?? 0,
        error: record.error ?? null,
      })
      .eq("id", record.taskId);
    if (updateErr)
      console.warn("[workforce] persistTaskFinal update failed:", updateErr.message);

    if (record.result) {
      const { error: insertErr } = await sb.from("workforce_task_results").upsert(
        {
          task_id: record.taskId,
          agent_id: record.agentId,
          output: record.result.output,
          cost_usd: record.result.costUsd,
          duration_ms: record.result.durationMs,
          completed_at: record.completedAt ?? new Date().toISOString(),
        },
        { onConflict: "task_id" },
      );
      if (insertErr)
        console.warn("[workforce] persistTaskFinal result upsert failed:", insertErr.message);
    }
  } catch (err) {
    console.warn("[workforce] persistTaskFinal threw:", String(err));
  }
}

// ---------------------------------------------------------------------------
// Reads — used by the API to fall back to DB when in-memory registry hasn't
// seen the task (e.g. after a process restart).
// ---------------------------------------------------------------------------

export interface PersistedTaskRow {
  id: string;
  agent_id: string;
  description: string;
  target_workspace: string | null;
  parent_task_id: string | null;
  parent_agent_id: string | null;
  state: string;
  cost_usd: number;
  duration_ms: number;
  error: { code: string; message: string } | null;
  principal_id: string;
  started_at: string;
  completed_at: string | null;
}

export interface PersistedResultRow {
  task_id: string;
  agent_id: string;
  output: string;
  cost_usd: number;
  duration_ms: number;
  completed_at: string;
}

export interface PersistedEventRow {
  task_id: string;
  seq: number;
  type: string;
  timestamp: string;
  agent_id: string;
  payload: Record<string, unknown>;
}

export async function fetchTask(
  taskId: string,
  principalId: string,
): Promise<PersistedTaskRow | null> {
  const sb = getWorkforceSupabase();
  if (!sb) return null;
  const { data, error } = await sb
    .from("workforce_tasks")
    .select("*")
    .eq("id", taskId)
    .eq("principal_id", principalId)
    .maybeSingle();
  if (error) {
    console.warn("[workforce] fetchTask failed:", error.message);
    return null;
  }
  return (data as PersistedTaskRow | null) ?? null;
}

export async function fetchResult(
  taskId: string,
): Promise<PersistedResultRow | null> {
  const sb = getWorkforceSupabase();
  if (!sb) return null;
  const { data, error } = await sb
    .from("workforce_task_results")
    .select("*")
    .eq("task_id", taskId)
    .maybeSingle();
  if (error) {
    console.warn("[workforce] fetchResult failed:", error.message);
    return null;
  }
  return (data as PersistedResultRow | null) ?? null;
}

export async function fetchEvents(taskId: string): Promise<PersistedEventRow[]> {
  const sb = getWorkforceSupabase();
  if (!sb) return [];
  const { data, error } = await sb
    .from("workforce_task_events")
    .select("*")
    .eq("task_id", taskId)
    .order("seq", { ascending: true });
  if (error) {
    console.warn("[workforce] fetchEvents failed:", error.message);
    return [];
  }
  return (data as PersistedEventRow[]) ?? [];
}

export async function fetchRecentTasks(
  principalId: string,
  limit = 50,
): Promise<PersistedTaskRow[]> {
  const sb = getWorkforceSupabase();
  if (!sb) return [];
  const { data, error } = await sb
    .from("workforce_tasks")
    .select("*")
    .eq("principal_id", principalId)
    .is("parent_task_id", null)
    .order("started_at", { ascending: false })
    .limit(limit);
  if (error) {
    console.warn("[workforce] fetchRecentTasks failed:", error.message);
    return [];
  }
  return (data as PersistedTaskRow[]) ?? [];
}
