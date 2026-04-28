import type { SupabaseClient } from "@supabase/supabase-js";
import type { ForgeActiveRunRow } from "@/lib/agents-active-status";

const ACTIVE_RUN_SELECT =
  "id, task_id, status, run_type, stage, started_at, created_at";
const ACTIVE_RUN_SELECT_WITH_AGENT_ROLE = `${ACTIVE_RUN_SELECT}, agent_role`;

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
