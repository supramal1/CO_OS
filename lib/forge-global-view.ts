import type { ForgeLane, ForgeTask } from "@/lib/agents-types";
import { LANE_ORDER } from "@/lib/agents-types";
import type { Brief, BriefStats } from "@/lib/forge-types";
import { BRIEF_STATUSES } from "@/lib/forge-types";

export const FORGE_TASK_SELECT =
  "id, title, description, lane, status, agent_id, priority, creator_type, creator_id, assignee_type, assignee_id, metadata, namespace, created_at, updated_at";

export function normaliseForgeLane(lane: string | null | undefined): ForgeLane {
  const candidates = new Set(LANE_ORDER);
  if (lane && candidates.has(lane as ForgeLane)) return lane as ForgeLane;
  return "backlog";
}

export function sortForgeTasks(tasks: readonly ForgeTask[]): ForgeTask[] {
  return [...tasks].sort((a, b) => {
    if (b.priority !== a.priority) return b.priority - a.priority;
    return b.updated_at.localeCompare(a.updated_at);
  });
}

export function groupForgeTasksByLane(
  tasks: readonly ForgeTask[],
): Record<ForgeLane, ForgeTask[]> {
  const groups: Record<ForgeLane, ForgeTask[]> = {
    backlog: [],
    research: [],
    research_review: [],
    production: [],
    production_review: [],
    done: [],
  };
  for (const task of sortForgeTasks(tasks)) {
    groups[normaliseForgeLane(task.lane)].push(task);
  }
  return groups;
}

export function buildGlobalBriefStats(briefs: readonly Brief[]): BriefStats {
  const byStatus = Object.fromEntries(
    BRIEF_STATUSES.map((status) => [status, 0]),
  ) as BriefStats["by_status"];
  for (const brief of briefs) {
    byStatus[brief.status] = (byStatus[brief.status] ?? 0) + 1;
  }
  return { total: briefs.length, by_status: byStatus };
}
