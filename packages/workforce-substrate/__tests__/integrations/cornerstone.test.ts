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

function makeCtx(
  task: Task = makeTask("aiops"),
  recentMessages?: ToolBuildContext["getRecentMessages"],
): ToolBuildContext {
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
    getRecentMessages: recentMessages,
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

  it("honours an agent-supplied namespace on reads even when the task has a targetWorkspace", async () => {
    // Audit/compliance flows legitimately need to scope outside the
    // pinned workspace. The substrate now lets the agent override on
    // reads — the Cornerstone API is the actual security boundary
    // (returns 403 if the principal lacks a grant).
    let payload: Record<string, unknown> | undefined;
    const fetchMock = vi.fn(async (_input: unknown, init?: RequestInit) => {
      payload =
        typeof init?.body === "string"
          ? (JSON.parse(init.body as string) as Record<string, unknown>)
          : undefined;
      return jsonResponse(200, { result: "context body" });
    }) as unknown as typeof fetch;
    const ctx = makeCtx(makeTask("aiops"));
    const tool = cornerstoneToolForTest("get_context", fetchMock)(ctx);
    await tool.dispatch({
      name: "get_context",
      toolUseId: "u1",
      input: { query: "hello", namespace: "default" },
    });
    expect(payload?.["namespace"]).toBe("default");
  });

  it("falls back to taskWorkspace when no namespace is supplied", async () => {
    let payload: Record<string, unknown> | undefined;
    const fetchMock = vi.fn(async (_input: unknown, init?: RequestInit) => {
      payload =
        typeof init?.body === "string"
          ? (JSON.parse(init.body as string) as Record<string, unknown>)
          : undefined;
      return jsonResponse(200, { result: "context body" });
    }) as unknown as typeof fetch;
    const ctx = makeCtx(makeTask("aiops"));
    const tool = cornerstoneToolForTest("get_context", fetchMock)(ctx);
    await tool.dispatch({
      name: "get_context",
      toolUseId: "u1",
      input: { query: "hello" },
    });
    expect(payload?.["namespace"]).toBe("aiops");
  });
});

describe("cornerstone — steward_inspect query params", () => {
  it("forwards all scalar GET inspect params alongside the resolved namespace", async () => {
    let calledUrl = "";
    const fetchMock = vi.fn(async (input: unknown) => {
      calledUrl = typeof input === "string" ? input : (input as Request).url;
      return jsonResponse(200, { total: 0, items: [] });
    }) as unknown as typeof fetch;
    const tool = cornerstoneToolForTest("steward_inspect", fetchMock)(
      makeCtx(makeTask("aiops")),
    );

    const out = await tool.dispatch({
      name: "steward_inspect",
      toolUseId: "u1",
      input: {
        operation: "missing-dates",
        namespace: "default",
        limit: 200,
        threshold: 0.91,
        include_resolved: true,
      },
    });

    expect(out.status).toBe("ok");
    const url = new URL(calledUrl);
    expect(url.pathname).toBe("/ops/steward/inspect/missing-dates");
    expect(url.searchParams.get("namespace")).toBe("default");
    expect(url.searchParams.get("limit")).toBe("200");
    expect(url.searchParams.get("threshold")).toBe("0.91");
    expect(url.searchParams.get("include_resolved")).toBe("true");
    expect(url.searchParams.has("operation")).toBe(false);
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

  it("add_fact injects recent runtime messages as conversation_context", async () => {
    let payload: Record<string, unknown> | undefined;
    const fetchMock = vi.fn(async (_input: unknown, init?: RequestInit) => {
      payload =
        typeof init?.body === "string"
          ? (JSON.parse(init.body as string) as Record<string, unknown>)
          : undefined;
      return jsonResponse(200, { ok: true });
    }) as unknown as typeof fetch;
    const recentMessages = () => [
      { role: "user" as const, content: "T4 Alan needs to re-spec the approval gate." },
      { role: "assistant" as const, content: "Alan should bind apply to Mal approval evidence." },
    ];
    const ctx = makeCtx(makeTask("aiops"), recentMessages);
    const tool = cornerstoneToolForTest("add_fact", fetchMock)(ctx);

    await tool.dispatch({
      name: "add_fact",
      toolUseId: "u1",
      input: {
        key: "alan_respec",
        value: "Alan re-spec approved 2026-04-29.",
      },
    });

    expect(payload?.["conversation_context"]).toEqual(recentMessages());
    expect(payload?.["honcho_session_id"]).toBe("task-1");
  });
});

describe("cornerstone — steward_preview namespace resolution", () => {
  it("honours an agent-supplied namespace on preview (read-only operation)", async () => {
    // steward_preview is read-only — it dry-runs the operation. Audit/
    // hygiene flows legitimately need to preview cleanup that lives in a
    // namespace different from the task's pinned workspace. Cornerstone's
    // grant model is the security boundary.
    let payload: Record<string, unknown> | undefined;
    let calledUrl = "";
    const fetchMock = vi.fn(async (input: unknown, init?: RequestInit) => {
      calledUrl = typeof input === "string" ? input : (input as Request).url;
      payload =
        typeof init?.body === "string"
          ? (JSON.parse(init.body as string) as Record<string, unknown>)
          : undefined;
      return jsonResponse(200, { candidates: [] });
    }) as unknown as typeof fetch;
    const ctx = makeCtx(makeTask("aiops"));
    const tool = cornerstoneToolForTest("steward_preview", fetchMock)(ctx);
    const out = await tool.dispatch({
      name: "steward_preview",
      toolUseId: "u1",
      input: { operation: "merge-duplicates", namespace: "default" },
    });
    expect(out.status).toBe("ok");
    expect(calledUrl).toContain("/preview");
    expect(payload?.["namespace"]).toBe("default");
  });

  it("falls back to taskWorkspace when no namespace is supplied", async () => {
    let payload: Record<string, unknown> | undefined;
    const fetchMock = vi.fn(async (_input: unknown, init?: RequestInit) => {
      payload =
        typeof init?.body === "string"
          ? (JSON.parse(init.body as string) as Record<string, unknown>)
          : undefined;
      return jsonResponse(200, { candidates: [] });
    }) as unknown as typeof fetch;
    const ctx = makeCtx(makeTask("aiops"));
    const tool = cornerstoneToolForTest("steward_preview", fetchMock)(ctx);
    await tool.dispatch({
      name: "steward_preview",
      toolUseId: "u1",
      input: { operation: "merge-duplicates" },
    });
    expect(payload?.["namespace"]).toBe("aiops");
  });
});

describe("cornerstone — steward_apply approval gating", () => {
  it("exposes confirmation_token on the steward_apply tool schema", () => {
    const fetchMock = vi.fn() as unknown as typeof fetch;
    const tool = cornerstoneToolForTest("steward_apply", fetchMock)(makeCtx());
    expect(tool.spec.input_schema.properties.confirmation_token).toMatchObject({
      type: "string",
    });
  });

  it("falls back to blocked / approval_queue_not_available when no requestApproval hook is wired", async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error("steward_apply must not reach the network without approval");
    }) as unknown as typeof fetch;
    const tool = cornerstoneToolForTest("steward_apply", fetchMock)(makeCtx());
    const out = await tool.dispatch({
      name: "steward_apply",
      toolUseId: "u1",
      input: { operation: "merge-duplicates" },
    });
    expect(out.status).toBe("blocked");
    expect(out.errorCode).toBe("approval_queue_not_available");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects with operator reason when the approval hook denies", async () => {
    const fetchMock = vi.fn(async (input: unknown) => {
      const url = typeof input === "string" ? input : (input as Request).url;
      // Preview is best-effort and is allowed to be hit before the
      // operator decides — we just don't want the apply endpoint touched
      // on rejection.
      if (url.includes("/apply")) {
        throw new Error("apply must not be called when operator rejects");
      }
      return jsonResponse(200, {
        candidates: [],
        confirmation_token: "tok-rejected",
      });
    }) as unknown as typeof fetch;
    const ctx = {
      ...makeCtx(),
      requestApproval: vi.fn(async () => ({
        approved: false,
        reason: "not yet, audit first",
      })),
    };
    const tool = cornerstoneToolForTest("steward_apply", fetchMock)(ctx);
    const out = await tool.dispatch({
      name: "steward_apply",
      toolUseId: "u1",
      input: { operation: "merge-duplicates" },
    });
    expect(out.status).toBe("blocked");
    expect(out.errorCode).toBe("approval_rejected");
    expect(out.errorMessage).toContain("not yet");
    expect(ctx.requestApproval).toHaveBeenCalledTimes(1);
  });

  it("calls the live /apply endpoint after the approval hook approves", async () => {
    const calls: string[] = [];
    let applyPayload: Record<string, unknown> | undefined;
    const fetchMock = vi.fn(async (input: unknown, init?: RequestInit) => {
      const url = typeof input === "string" ? input : (input as Request).url;
      calls.push(url);
      if (url.includes("/preview")) {
        return jsonResponse(200, {
          candidates: [1, 2],
          confirmation_token: "tok-from-preview",
        });
      }
      if (url.includes("/apply")) {
        applyPayload =
          typeof init?.body === "string"
            ? (JSON.parse(init.body) as Record<string, unknown>)
            : undefined;
        return jsonResponse(200, { applied: 2 });
      }
      throw new Error(`unexpected url: ${url}`);
    }) as unknown as typeof fetch;
    const ctx = {
      ...makeCtx(),
      requestApproval: vi.fn(async () => ({ approved: true })),
    };
    const tool = cornerstoneToolForTest("steward_apply", fetchMock)(ctx);
    const out = await tool.dispatch({
      name: "steward_apply",
      toolUseId: "u1",
      input: { operation: "merge-duplicates" },
    });
    expect(out.status).toBe("ok");
    expect(out.output).toMatchObject({ applied: 2 });
    expect(calls.some((u) => u.includes("/apply"))).toBe(true);
    expect(applyPayload?.["confirmation_token"]).toBe("tok-from-preview");
    expect(ctx.requestApproval).toHaveBeenCalledTimes(1);
    expect(ctx.requestApproval).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({
          confirmation_token: "tok-from-preview",
        }),
      }),
    );
  });

  it("forwards a caller-provided confirmation_token to the live /apply endpoint", async () => {
    let previewPayload: Record<string, unknown> | undefined;
    let applyPayload: Record<string, unknown> | undefined;
    const fetchMock = vi.fn(async (input: unknown, init?: RequestInit) => {
      const url = typeof input === "string" ? input : (input as Request).url;
      if (url.includes("/preview")) {
        previewPayload =
          typeof init?.body === "string"
            ? (JSON.parse(init.body) as Record<string, unknown>)
            : undefined;
        return jsonResponse(200, { candidates: [1, 2] });
      }
      if (url.includes("/apply")) {
        applyPayload =
          typeof init?.body === "string"
            ? (JSON.parse(init.body) as Record<string, unknown>)
            : undefined;
        return jsonResponse(200, { applied: 2 });
      }
      throw new Error(`unexpected url: ${url}`);
    }) as unknown as typeof fetch;
    const ctx = {
      ...makeCtx(),
      requestApproval: vi.fn(async () => ({ approved: true })),
    };
    const tool = cornerstoneToolForTest("steward_apply", fetchMock)(ctx);
    const out = await tool.dispatch({
      name: "steward_apply",
      toolUseId: "u1",
      input: {
        operation: "merge-duplicates",
        confirmation_token: "tok-from-donald",
      },
    });
    expect(out.status).toBe("ok");
    expect(out.output).toMatchObject({ applied: 2 });
    expect(previewPayload?.["confirmation_token"]).toBeUndefined();
    expect(applyPayload?.["confirmation_token"]).toBe("tok-from-donald");
    expect(ctx.requestApproval).toHaveBeenCalledTimes(1);
  });

  it("rejects unsupported operations before contacting the operator", async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error("must not contact API for invalid operation");
    }) as unknown as typeof fetch;
    const requestApproval = vi.fn();
    const ctx = { ...makeCtx(), requestApproval };
    const tool = cornerstoneToolForTest("steward_apply", fetchMock)(ctx);
    const out = await tool.dispatch({
      name: "steward_apply",
      toolUseId: "u1",
      input: { operation: "lol-not-a-thing" },
    });
    expect(out.status).toBe("error");
    expect(out.errorCode).toBe("unsupported_operation");
    expect(requestApproval).not.toHaveBeenCalled();
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
