import { describe, expect, it, vi } from "vitest";
import {
  cancelConfirmMessage,
  cancelForgeTaskOptimistically,
  cancelledForgeTask,
  isForgeTaskCancellable,
} from "@/lib/agents-cancel";
import type { ForgeTask, TaskStatus } from "@/lib/agents-types";

function task(overrides: Partial<ForgeTask> = {}): ForgeTask {
  return {
    id: "t1",
    title: "Cancel me",
    description: null,
    lane: "research",
    status: "running",
    agent_id: null,
    priority: 0,
    creator_type: null,
    creator_id: null,
    assignee_type: null,
    assignee_id: null,
    metadata: null,
    namespace: "aiops",
    created_at: "2026-04-28T09:00:00.000Z",
    updated_at: "2026-04-28T09:10:00.000Z",
    ...overrides,
  };
}

describe("Forge task cancel state", () => {
  it("only exposes cancel for running tasks", () => {
    expect(isForgeTaskCancellable(task({ status: "running" }))).toBe(true);

    const blocked: TaskStatus[] = [
      "submitted",
      "scoping",
      "building",
      "ready",
      "completed",
      "failed",
      "cancelled",
    ];
    for (const status of blocked) {
      expect(isForgeTaskCancellable(task({ status }))).toBe(false);
    }
  });

  it("optimistically marks a task cancelled in the done lane", () => {
    expect(
      cancelledForgeTask(task(), () => new Date("2026-04-28T10:00:00.000Z")),
    ).toMatchObject({
      id: "t1",
      status: "cancelled",
      lane: "done",
      updated_at: "2026-04-28T10:00:00.000Z",
    });
  });

  it("uses a specific confirmation message", () => {
    expect(cancelConfirmMessage(task({ title: "Ship T4" }))).toBe(
      'Cancel task "Ship T4"?',
    );
  });
});

describe("cancelForgeTaskOptimistically", () => {
  it("does not call the API when confirmation is declined", async () => {
    const fetcher = vi.fn();
    const onOptimistic = vi.fn();

    const didCancel = await cancelForgeTaskOptimistically({
      task: task(),
      namespaceQuery: "?namespace=aiops",
      confirm: () => false,
      fetcher,
      onOptimistic,
      onRollback: vi.fn(),
      onSuccess: vi.fn(),
      onError: vi.fn(),
    });

    expect(didCancel).toBe(false);
    expect(fetcher).not.toHaveBeenCalled();
    expect(onOptimistic).not.toHaveBeenCalled();
  });

  it("applies optimistic state, then commits the server response", async () => {
    const calls: string[] = [];
    const serverTask = task({
      lane: "done",
      status: "cancelled",
      updated_at: "2026-04-28T10:01:00.000Z",
    });
    const fetcher = vi.fn(async () => {
      calls.push("fetch");
      return new Response(JSON.stringify(serverTask), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
    const onSuccess = vi.fn((next: ForgeTask) => {
      calls.push(`success:${next.updated_at}`);
    });

    const didCancel = await cancelForgeTaskOptimistically({
      task: task(),
      namespaceQuery: "?namespace=aiops",
      confirm: () => true,
      fetcher,
      now: () => new Date("2026-04-28T10:00:00.000Z"),
      onOptimistic: (next) => {
        calls.push(`optimistic:${next.status}:${next.lane}`);
      },
      onRollback: vi.fn(),
      onSuccess,
      onError: vi.fn(),
    });

    expect(didCancel).toBe(true);
    expect(fetcher).toHaveBeenCalledWith(
      "/api/forge/tasks/t1/cancel?namespace=aiops",
      { method: "POST" },
    );
    expect(calls).toEqual([
      "optimistic:cancelled:done",
      "fetch",
      "success:2026-04-28T10:01:00.000Z",
    ]);
  });

  it("rolls back optimistic state on API failure", async () => {
    const original = task();
    const onRollback = vi.fn();
    const onError = vi.fn();

    const didCancel = await cancelForgeTaskOptimistically({
      task: original,
      namespaceQuery: "",
      confirm: () => true,
      fetcher: vi.fn(async () => {
        return new Response(JSON.stringify({ detail: "cancel unavailable" }), {
          status: 502,
          headers: { "Content-Type": "application/json" },
        });
      }),
      onOptimistic: vi.fn(),
      onRollback,
      onSuccess: vi.fn(),
      onError,
    });

    expect(didCancel).toBe(false);
    expect(onRollback).toHaveBeenCalledWith(original);
    expect(onError).toHaveBeenCalledWith("cancel unavailable");
  });
});
