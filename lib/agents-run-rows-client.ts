import type { SupabaseClient } from "@supabase/supabase-js";
import type { ForgeActiveRunRow } from "@/lib/agents-active-status";
import type { ForgeTaskRunRow } from "@/lib/agents-detail-display";

const ACTIVE_RUN_SELECT =
  "id, task_id, status, run_type, stage, started_at, created_at";
const ACTIVE_RUN_SELECT_WITH_AGENT_ROLE = `${ACTIVE_RUN_SELECT}, agent_role`;

const DETAIL_RUN_SELECT =
  "id, task_id, run_type, stage, status, actual_cost_usd, output, error, pr_url, started_at, completed_at, created_at";
const DETAIL_RUN_SELECT_WITH_AGENT_ROLE = `${DETAIL_RUN_SELECT}, agent_role`;

export async function fetchActiveRunRowsForTasks(
  sb: SupabaseClient,
  taskIds: readonly string[],
): Promise<ForgeActiveRunRow[]> {
  const ids = [...new Set(taskIds)].filter(Boolean);
  if (ids.length === 0) return [];

  const withAgent = await queryActiveRunRows(
    sb,
    ids,
    ACTIVE_RUN_SELECT_WITH_AGENT_ROLE,
  );
  if (!withAgent.error) return withAgent.rows;

  const fallback = await queryActiveRunRows(sb, ids, ACTIVE_RUN_SELECT);
  return fallback.error ? [] : fallback.rows;
}

export async function fetchTaskRunRowsForDetail(
  sb: SupabaseClient,
  taskId: string,
): Promise<{ rows: ForgeTaskRunRow[]; error: string | null }> {
  const withAgent = await queryDetailRunRows(
    sb,
    taskId,
    DETAIL_RUN_SELECT_WITH_AGENT_ROLE,
  );
  if (!withAgent.error) return withAgent;

  return queryDetailRunRows(sb, taskId, DETAIL_RUN_SELECT);
}

async function queryActiveRunRows(
  sb: SupabaseClient,
  taskIds: string[],
  select: string,
): Promise<{ rows: ForgeActiveRunRow[]; error: string | null }> {
  const { data, error } = await sb
    .from("forge_task_runs")
    .select(select)
    .eq("status", "running")
    .in("task_id", taskIds)
    .limit(Math.max(50, taskIds.length * 4));

  if (error) return { rows: [], error: error.message };
  return { rows: (data ?? []) as unknown as ForgeActiveRunRow[], error: null };
}

async function queryDetailRunRows(
  sb: SupabaseClient,
  taskId: string,
  select: string,
): Promise<{ rows: ForgeTaskRunRow[]; error: string | null }> {
  const { data, error } = await sb
    .from("forge_task_runs")
    .select(select)
    .eq("task_id", taskId)
    .order("created_at", { ascending: true });

  if (error) return { rows: [], error: error.message };
  return { rows: (data ?? []) as unknown as ForgeTaskRunRow[], error: null };
}
