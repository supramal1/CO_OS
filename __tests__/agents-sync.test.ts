import { describe, expect, it } from "vitest";
import {
  applyRealtimeTaskEvent,
  mergePolledTasks,
  shouldPollAgentsTasks,
} from "@/lib/agents-sync";
import type { ForgeTask } from "@/lib/agents-types";

function task(id: string, lane: ForgeTask["lane"], updatedAt: string): ForgeTask {
  return {
    id,
    title: id,
    description: null,
    lane,
    status: "submitted",
    agent_id: null,
    priority: 0,
    creator_type: null,
    creator_id: null,
    assignee_type: null,
    assignee_id: null,
    metadata: null,
    namespace: "aiops",
    created_at: "2026-04-27T00:00:00Z",
    updated_at: updatedAt,
  };
}

describe("mergePolledTasks", () => {
  it("keeps newer optimistic local rows over stale poll results", () => {
    const optimistic = task("t1", "research", "2026-04-27T10:00:05.000Z");
    const staleBackend = task("t1", "backlog", "2026-04-27T10:00:00.000Z");

    expect(mergePolledTasks([optimistic], [staleBackend])).toEqual([
      optimistic,
    ]);
  });

  it("applies newer backend rows and includes new polled rows", () => {
    const oldLocal = task("t1", "research", "2026-04-27T10:00:00.000Z");
    const newerBackend = task(
      "t1",
      "research_review",
      "2026-04-27T10:00:10.000Z",
    );
    const newBackend = task("t2", "backlog", "2026-04-27T10:00:02.000Z");

    expect(mergePolledTasks([oldLocal], [newerBackend, newBackend])).toEqual([
      newerBackend,
      newBackend,
    ]);
  });
});

describe("applyRealtimeTaskEvent", () => {
  it("removes a task on realtime delete", () => {
    expect(
      applyRealtimeTaskEvent(
        [task("t1", "backlog", "2026-04-27T10:00:00.000Z")],
        task("t1", "backlog", "2026-04-27T10:00:01.000Z"),
        "DELETE",
      ),
    ).toEqual([]);
  });

  it("ignores stale realtime updates that would snap back an optimistic lane", () => {
    const optimistic = task("t1", "research", "2026-04-27T10:00:05.000Z");
    const staleEvent = task("t1", "backlog", "2026-04-27T10:00:00.000Z");

    expect(
      applyRealtimeTaskEvent([optimistic], staleEvent, "UPDATE"),
    ).toEqual([optimistic]);
  });

  it("inserts unseen realtime rows", () => {
    const incoming = task("t1", "backlog", "2026-04-27T10:00:00.000Z");

    expect(applyRealtimeTaskEvent([], incoming, "INSERT")).toEqual([incoming]);
  });
});

describe("shouldPollAgentsTasks", () => {
  it("skips interval polling while the tab is hidden", () => {
    expect(shouldPollAgentsTasks("hidden")).toBe(false);
    expect(shouldPollAgentsTasks("visible")).toBe(true);
    expect(shouldPollAgentsTasks(undefined)).toBe(true);
  });
});
