// Cornerstone integration tests.
//
// We bypass the public ToolBuilder API and use cornerstoneToolForTest, which
// lets us inject a mock fetch. This isolates dispatch behaviour (namespace
// resolution, write-namespace forcing, steward_apply blocking, error mapping)
// from any live Cornerstone API.

import { describe, expect, it, vi } from "vitest";
import { cornerstoneToolForTest } from "../../src/integrations/cornerstone.js";
import type {
  Agent,
  Task,
  ToolBuildContext,
} from "../../src/types.js";

function makeAgent(): Agent {
  return {
    id: "donald",
    name: "Donald",
    systemPromptSkill: "donald-system-prompt",
    model: "claude-sonnet-4-6",
    canDelegate: false,
    canUseCornerstoneRead: true,
    canUseCornerstoneWrite: true,
    reportsTo: "ada",
    defaultWorkspace: "aiops",
    toolBuilders: [],
  };
}

function makeTask(targetWorkspace?: string): Task {
  return {
    id: "task-1",
    description: "test",
    targetWorkspace,
    parentTaskId: undefined,
    parentAgentId: undefined,
    ancestry: [],
    context: undefined,
    maxCostUsd: undefined,
  };
}

function makeCtx(task: Task = makeTask("aiops")): ToolBuildContext {
  return {
    agent: makeAgent(),
    task,
    eventLog: {
      emit() {
        return {
          type: "model_turn",
          timestamp: "",
          seq: 0,
          taskId: "",
          agentId: "",
          payload: {},
        };
      },
      entries() {
        return [];
      },
    },
    invokeChild: undefined,
    roster: undefined,
    anthropicApiKey: "test",
    cornerstoneApiKey: "csk_test",
    cornerstoneApiBaseUrl: "https://cornerstone.test",
  };
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("cornerstone — read tools", () => {
  it("get_context POSTs to /context with the agent input", async () => {
    const fetchMock = vi.fn(async (input: unknown) => {
      const url = typeof input === "string" ? input : (input as Request).url;
      expect(url).toContain("/context");
      return jsonResponse(200, { result: "context body", request_id: "req-1" });
    }) as unknown as typeof fetch;
    const tool = cornerstoneToolForTest("get_context", fetchMock)(makeCtx());
    const out = await tool.dispatch({
      name: "get_context",
      toolUseId: "u1",
      input: { query: "hello" },
    });
    expect(out.status).toBe("ok");
    expect(fetchMock).toHaveBeenCalled();
  });

  it("forwards 5xx as an error", async () => {
    const fetchMock = vi.fn(
      async () => jsonResponse(500, { error: "internal_error" }),
    ) as unknown as typeof fetch;
    const tool = cornerstoneToolForTest("get_context", fetchMock)(makeCtx());
    const out = await tool.dispatch({
      name: "get_context",
      toolUseId: "u1",
      input: { query: "hello" },
    });
    expect(out.status).toBe("error");
  });
});

describe("cornerstone — write namespace forcing", () => {
  it("add_fact forces the task targetWorkspace even if the agent passes a different namespace", async () => {
    let payload: Record<string, unknown> | undefined;
    const fetchMock = vi.fn(async (input: unknown, init?: RequestInit) => {
      const body = init?.body;
      payload =
        typeof body === "string"
          ? (JSON.parse(body) as Record<string, unknown>)
          : undefined;
      return jsonResponse(200, { ok: true });
    }) as unknown as typeof fetch;
    const ctx = makeCtx(makeTask("aiops"));
    const tool = cornerstoneToolForTest("add_fact", fetchMock)(ctx);
    await tool.dispatch({
      name: "add_fact",
      toolUseId: "u1",
      input: {
        key: "test_fact",
        value: "hello (as of 2026-04-26)",
        namespace: "client-paid-media", // attempt to override
      },
    });
    expect(payload?.["namespace"]).toBe("aiops");
  });

  it("add_fact falls back to AI_OPS_WORKSPACE when task has no targetWorkspace", async () => {
    let payload: Record<string, unknown> | undefined;
    const fetchMock = vi.fn(async (_input: unknown, init?: RequestInit) => {
      payload =
        typeof init?.body === "string"
          ? (JSON.parse(init.body as string) as Record<string, unknown>)
          : undefined;
      return jsonResponse(200, { ok: true });
    }) as unknown as typeof fetch;
    const ctx = makeCtx(makeTask(undefined));
    const tool = cornerstoneToolForTest("add_fact", fetchMock)(ctx);
    await tool.dispatch({
      name: "add_fact",
      toolUseId: "u1",
      input: {
        key: "test_fact",
        value: "hello (as of 2026-04-26)",
      },
    });
    expect(payload?.["namespace"]).toBe("aiops");
  });
});

describe("cornerstone — steward_apply blocked in v0", () => {
  it("returns blocked status with pending_approval / approval_queue_not_available", async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error("steward_apply must not reach the network in v0");
    }) as unknown as typeof fetch;
    const tool = cornerstoneToolForTest("steward_apply", fetchMock)(makeCtx());
    const out = await tool.dispatch({
      name: "steward_apply",
      toolUseId: "u1",
      input: { recommendation_id: "rec-123" },
    });
    expect(out.status).toBe("blocked");
    expect(out.errorCode).toBeDefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("cornerstone — error mapping", () => {
  it("translates a 403 namespace-grant failure into target_workspace_grant_missing", async () => {
    const fetchMock = vi.fn(
      async () =>
        jsonResponse(403, {
          error: "forbidden",
          detail: "namespace_not_granted: agent lacks grant for client-paid-media",
        }),
    ) as unknown as typeof fetch;
    const ctx = makeCtx(makeTask("client-paid-media"));
    const tool = cornerstoneToolForTest("get_context", fetchMock)(ctx);
    const out = await tool.dispatch({
      name: "get_context",
      toolUseId: "u1",
      input: { query: "hello" },
    });
    expect(out.status).toBe("error");
    expect(out.errorCode).toBe("target_workspace_grant_missing");
  });
});
