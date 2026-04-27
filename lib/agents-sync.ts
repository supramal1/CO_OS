import type { ForgeTask } from "@/lib/agents-types";

export const AGENTS_TASKS_POLL_MS = 10_000;

function isIncomingAtLeastAsNew(
  current: ForgeTask,
  incoming: ForgeTask,
): boolean {
  return incoming.updated_at >= current.updated_at;
}

export function mergePolledTasks(
  currentTasks: ForgeTask[],
  incomingTasks: ForgeTask[],
): ForgeTask[] {
  const byId = new Map(currentTasks.map((task) => [task.id, task]));
  for (const incoming of incomingTasks) {
    const current = byId.get(incoming.id);
    if (!current || isIncomingAtLeastAsNew(current, incoming)) {
      byId.set(incoming.id, incoming);
    }
  }
  return Array.from(byId.values());
}

export function applyRealtimeTaskEvent(
  currentTasks: ForgeTask[],
  row: ForgeTask,
  eventType: string,
): ForgeTask[] {
  if (eventType === "DELETE") {
    return currentTasks.filter((task) => task.id !== row.id);
  }

  const idx = currentTasks.findIndex((task) => task.id === row.id);
  if (idx === -1) return [...currentTasks, row];

  const current = currentTasks[idx];
  if (!isIncomingAtLeastAsNew(current, row)) return currentTasks;

  const next = [...currentTasks];
  next[idx] = row;
  return next;
}

export function shouldPollAgentsTasks(
  visibilityState: DocumentVisibilityState | undefined,
): boolean {
  return visibilityState !== "hidden";
}
