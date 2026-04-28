import type {
  InvocationState,
  PublicEventLogEntry,
} from "./types";

export const WORKFORCE_DETAIL_POLL_MS = 2_000;

export function shouldPollTaskDetail(
  state: InvocationState | null | undefined,
): boolean {
  return state == null || state === "queued" || state === "running";
}

export function mergeTaskEventLogs(
  current: readonly PublicEventLogEntry[],
  incoming: readonly PublicEventLogEntry[],
): PublicEventLogEntry[] {
  if (incoming.length === 0) return [...current];

  const byKey = new Map<string, PublicEventLogEntry>();
  for (const event of current) byKey.set(eventKey(event), event);
  for (const event of incoming) byKey.set(eventKey(event), event);

  return [...byKey.values()].sort(compareEvents);
}

function eventKey(event: PublicEventLogEntry): string {
  return `${event.taskId}:${event.seq}`;
}

function compareEvents(a: PublicEventLogEntry, b: PublicEventLogEntry): number {
  if (a.timestamp < b.timestamp) return -1;
  if (a.timestamp > b.timestamp) return 1;
  if (a.seq !== b.seq) return a.seq - b.seq;
  return a.taskId.localeCompare(b.taskId);
}
