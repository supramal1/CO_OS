import type { SupabaseClient } from "@supabase/supabase-js";
import type { ForgeActiveRunRow } from "@/lib/agents-active-status";

const ACTIVE_RUN_SELECT =
  "id, task_id, status, run_type, stage, started_at, created_at";

export async function fetchActiveRunRowsForTasks(
  sb: SupabaseClient,
  taskIds: readonly string[],
): Promise<ForgeActiveRunRow[]> {
  const ids = [...new Set(taskIds)].filter(Boolean);
  if (ids.length === 0) return [];

  const result = await queryActiveRunRows(sb, ids);
  return result.error ? [] : result.rows;
}

async function queryActiveRunRows(
  sb: SupabaseClient,
  taskIds: string[],
): Promise<{ rows: ForgeActiveRunRow[]; error: string | null }> {
  const { data, error } = await sb
    .from("forge_task_runs")
    .select(ACTIVE_RUN_SELECT)
    .eq("status", "running")
    .in("task_id", taskIds)
    .limit(Math.max(50, taskIds.length * 4));

  if (error) return { rows: [], error: error.message };
  return { rows: (data ?? []) as unknown as ForgeActiveRunRow[], error: null };
}
