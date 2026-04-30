import { getWorkbenchSupabase } from "../supabase";
import type { WorkbenchUserConfig } from "./types";

export async function getUserWorkbenchConfig(
  userId: string,
): Promise<WorkbenchUserConfig | null> {
  const sb = getWorkbenchSupabase();
  if (!sb) return null;
  const { data, error } = await sb
    .from("user_workbench_config")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) {
    console.warn("[workbench] config lookup failed:", error.message);
    return null;
  }
  return (data as WorkbenchUserConfig | null) ?? null;
}
