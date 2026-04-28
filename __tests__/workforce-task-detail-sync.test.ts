import { describe, expect, it } from "vitest";
import {
  mergeTaskEventLogs,
  shouldPollTaskDetail,
} from "@/lib/workforce/task-detail-sync";
import type { PublicEventLogEntry } from "@/lib/workforce/types";

function event(
  taskId: string,
  seq: number,
  type: PublicEventLogEntry["type"],
  timestamp = `2026-04-28T10:00:${String(seq).padStart(2, "0")}.000Z`,
): PublicEventLogEntry {
  return {
    taskId,
    seq,
    type,
    timestamp,
    agentId: "ada",
    payload: {},
  };
}

describe("mergeTaskEventLogs", () => {
  it("merges polled detail snapshots with SSE events without duplicating", () => {
    const initial = [event("parent", 0, "task_started")];
    const sseOnly = event("child", 1, "tool_called");
    const polledSnapshot = [
      event("parent", 0, "task_started"),
      sseOnly,
      event("child", 2, "tool_returned"),
    ];

    expect(mergeTaskEventLogs([...initial, sseOnly], polledSnapshot)).toEqual([
      event("parent", 0, "task_started"),
      event("child", 1, "tool_called"),
      event("child", 2, "tool_returned"),
    ]);
  });

  it("keeps events distinct by task id and sequence", () => {
    const merged = mergeTaskEventLogs(
      [event("parent", 1, "model_turn")],
      [event("child", 1, "task_started")],
    );

    expect(merged).toHaveLength(2);
    expect(merged).toContainEqual(event("parent", 1, "model_turn"));
    expect(merged).toContainEqual(event("child", 1, "task_started"));
  });
});

describe("shouldPollTaskDetail", () => {
  it("polls until the task reaches a terminal state", () => {
    expect(shouldPollTaskDetail(null)).toBe(true);
    expect(shouldPollTaskDetail("queued")).toBe(true);
    expect(shouldPollTaskDetail("running")).toBe(true);
    expect(shouldPollTaskDetail("completed")).toBe(false);
    expect(shouldPollTaskDetail("failed")).toBe(false);
    expect(shouldPollTaskDetail("cancelled")).toBe(false);
  });
});
