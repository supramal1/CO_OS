import type { WorkbenchInvocationLogRow } from "./types";
import { getWorkbenchSupabase } from "./supabase";

export async function persistWorkbenchInvocation(
  log: WorkbenchInvocationLogRow,
): Promise<void> {
  const sb = getWorkbenchSupabase();
  if (!sb) return;
  try {
    const { error } = await sb.from("workbench_invocation_logs").insert(log);
    if (error) {
      console.warn("[workbench] invocation log insert failed:", error.message);
    }
  } catch (err) {
    console.warn("[workbench] invocation log insert threw:", String(err));
  }
}
