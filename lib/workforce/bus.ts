// In-process pub/sub for streaming substrate event logs to SSE clients.
//
// Single-process only. When CO_OS scales beyond min-1 instance on Vercel
// or Cloud Run, replace this with Postgres LISTEN/NOTIFY or Redis pub/sub.
// For Night 1 dogfood (one user, one instance), an in-process EventEmitter
// keeps the surface tiny and zero-dependency.

import { EventEmitter } from "node:events";
import type { EventLogEntry } from "@workforce/substrate";

type BusEvent =
  | { kind: "event"; entry: EventLogEntry }
  | { kind: "end"; state: string };

declare global {
  // eslint-disable-next-line no-var
  var __wf_channels: Map<string, EventEmitter> | undefined;
}

const channels: Map<string, EventEmitter> =
  (globalThis.__wf_channels ??= new Map());

function getChannel(taskId: string): EventEmitter {
  let ch = channels.get(taskId);
  if (!ch) {
    ch = new EventEmitter();
    ch.setMaxListeners(32);
    channels.set(taskId, ch);
  }
  return ch;
}

export function publishEvent(taskId: string, entry: EventLogEntry): void {
  getChannel(taskId).emit("msg", { kind: "event", entry } satisfies BusEvent);
}

export function publishEnd(taskId: string, state: string): void {
  const ch = getChannel(taskId);
  ch.emit("msg", { kind: "end", state } satisfies BusEvent);
  // Drain after a short grace period so late SSE replays don't miss the
  // terminal frame, then drop the channel.
  setTimeout(() => {
    ch.removeAllListeners();
    channels.delete(taskId);
  }, 5_000);
}

export function subscribe(
  taskId: string,
  handler: (msg: BusEvent) => void,
): () => void {
  const ch = getChannel(taskId);
  ch.on("msg", handler);
  return () => {
    ch.off("msg", handler);
  };
}

export function hasChannel(taskId: string): boolean {
  return channels.has(taskId);
}

export type { BusEvent };
