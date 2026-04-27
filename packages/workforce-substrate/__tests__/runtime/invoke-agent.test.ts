// invokeAgent runtime tests.
//
// We mock the Anthropic SDK and the Cookbook system-prompt loader so the
// runtime is tested in isolation: no network, no env, no real keys.

import { describe, expect, it } from "vitest";
import {
  invokeAgent,
  type AnthropicClientLike,
} from "../../src/runtime/claude-agent.js";
import {
  type Agent,
  type Task,
  type Tool,
  type ToolBuilder,
  type ToolCallInput,
  type ToolCallResult,
  type TaskResult,
} from "../../src/types.js";
import type Anthropic from "@anthropic-ai/sdk";

function makeAgent(overrides: Partial<Agent>): Agent {
  return {
    id: "test-agent",
    name: "Test",
    systemPromptSkill: "test-prompt",
    model: "claude-haiku-4-5-20251001",
    canDelegate: false,
    canUseCornerstoneRead: false,
    canUseCornerstoneWrite: false,
    reportsTo: undefined,
    defaultWorkspace: "aiops",
    toolBuilders: [],
    ...overrides,
  };
}

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: "task-test",
    description: "do the thing",
    targetWorkspace: "aiops",
    parentTaskId: undefined,
    parentAgentId: undefined,
    ancestry: [],
    context: undefined,
    maxCostUsd: undefined,
    ...overrides,
  };
}

function textOnly(text: string): Anthropic.Messages.Message {
  return {
    id: "msg-1",
    type: "message",
    role: "assistant",
    model: "claude-haiku-4-5-20251001",
    content: [{ type: "text", text, citations: [] }],
    stop_reason: "end_turn",
    stop_sequence: null,
    usage: {
      input_tokens: 10,
      output_tokens: 4,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
      service_tier: null,
      server_tool_use: null,
    },
  } as unknown as Anthropic.Messages.Message;
}

function toolUse(id: string, name: string, input: Record<string, unknown>): Anthropic.Messages.ToolUseBlock {
  return { type: "tool_use", id, name, input } as unknown as Anthropic.Messages.ToolUseBlock;
}

function turnWithToolUse(blocks: Anthropic.Messages.ToolUseBlock[]): Anthropic.Messages.Message {
  return {
    id: "msg-tu",
    type: "message",
    role: "assistant",
    model: "claude-haiku-4-5-20251001",
    content: blocks,
    stop_reason: "tool_use",
    stop_sequence: null,
    usage: {
      input_tokens: 5,
      output_tokens: 2,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
      service_tier: null,
      server_tool_use: null,
    },
  } as unknown as Anthropic.Messages.Message;
}

function makeClient(scripted: Anthropic.Messages.Message[]): AnthropicClientLike {
  let i = 0;
  return {
    messages: {
      create: async () => {
        const next = scripted[i++];
        if (!next) throw new Error("test client out of scripted responses");
        return next;
      },
    },
  };
}

describe("invokeAgent — happy path", () => {
  it("returns the assistant text on a single end_turn", async () => {
    const result = await invokeAgent(makeAgent({}), makeTask(), {
      anthropicApiKey: "test",
      systemPromptLoader: async () => "you are a test agent",
      clientFactory: () => makeClient([textOnly("hello, world")]),
    });
    expect(result.status).toBe("completed");
    expect(result.output).toContain("hello, world");
    expect(result.output).toContain("Runtime cost summary");
    expect(result.error).toBeUndefined();
    expect(result.costUsd).toBeGreaterThan(0);
    expect(result.totalCostUsd).toBe(result.costUsd);
  });
});

describe("invokeAgent — tool dispatch loop", () => {
  it("dispatches tools in parallel and feeds results back into the next turn", async () => {
    const calls: string[] = [];
    const echoBuilder: ToolBuilder = () => ({
      spec: {
        name: "echo",
        description: "echo back",
        input_schema: {
          type: "object",
          properties: { text: { type: "string" } },
          required: ["text"],
        },
      },
      dispatch: async (call: ToolCallInput): Promise<ToolCallResult> => {
        calls.push(String(call.input["text"]));
        return { status: "ok", output: { echoed: call.input["text"] } };
      },
    });

    const turn1 = turnWithToolUse([
      toolUse("u1", "echo", { text: "alpha" }),
      toolUse("u2", "echo", { text: "beta" }),
    ]);
    const turn2 = textOnly("done");

    const result = await invokeAgent(
      makeAgent({ toolBuilders: [echoBuilder] }),
      makeTask(),
      {
        anthropicApiKey: "test",
        systemPromptLoader: async () => "test",
        clientFactory: () => makeClient([turn1, turn2]),
      },
    );

    expect(result.status).toBe("completed");
    expect(result.output).toContain("done");
    expect(result.output).toContain("Runtime cost summary");
    expect(calls.sort()).toEqual(["alpha", "beta"]);
    const toolReturns = result.eventLog.filter((e) => e.type === "tool_returned");
    expect(toolReturns).toHaveLength(2);
  });

  it("captures childResult onto TaskResult.children when a tool attaches one", async () => {
    const childTaskResult = {
      taskId: "child-1",
      agentId: "donald",
      status: "completed" as const,
      output: "child output",
      eventLog: [],
      costUsd: 0.001,
      totalCostUsd: 0.001,
      durationMs: 1,
      children: [],
    };
    const fakeDelegate: ToolBuilder = () => ({
      spec: {
        name: "delegate_task",
        description: "delegate",
        input_schema: { type: "object", properties: {} },
      },
      dispatch: async () => ({
        status: "ok",
        output: { delegated: true },
        childResult: childTaskResult,
      } as ToolCallResult & { childResult?: typeof childTaskResult }),
    });

    const turn1 = turnWithToolUse([toolUse("u1", "delegate_task", {})]);
    const turn2 = textOnly("synthesised");

    const result = await invokeAgent(
      makeAgent({ toolBuilders: [fakeDelegate] }),
      makeTask(),
      {
        anthropicApiKey: "test",
        systemPromptLoader: async () => "test",
        clientFactory: () => makeClient([turn1, turn2]),
      },
    );
    expect(result.status).toBe("completed");
    expect(result.children).toHaveLength(1);
    expect(result.children[0]?.taskId).toBe("child-1");
  });

  it("computes recursive total cost and appends a root-only runtime footer", async () => {
    const childTaskResult: TaskResult = {
      taskId: "child-1",
      agentId: "donald",
      status: "completed",
      output: "child output",
      eventLog: [],
      costUsd: 0.001,
      totalCostUsd: 0.0015,
      durationMs: 1,
      children: [],
    };
    const fakeDelegate: ToolBuilder = () => ({
      spec: {
        name: "delegate_task",
        description: "delegate",
        input_schema: { type: "object", properties: {} },
      },
      dispatch: async () => ({
        status: "ok",
        output: { delegated: true },
        childResult: childTaskResult,
      } as ToolCallResult & { childResult?: TaskResult }),
    });

    const turn1 = turnWithToolUse([toolUse("u1", "delegate_task", {})]);
    const turn2 = textOnly("synthesised");

    const result = await invokeAgent(
      makeAgent({ toolBuilders: [fakeDelegate] }),
      makeTask(),
      {
        anthropicApiKey: "test",
        systemPromptLoader: async () => "test",
        clientFactory: () => makeClient([turn1, turn2]),
      },
    );

    expect(result.costUsd).toBe(0.000045);
    expect(result.totalCostUsd).toBe(0.001545);
    expect(result.output).toContain("synthesised");
    expect(result.output).toContain("Runtime cost summary");
    expect(result.output).toContain("Parent model: $0.000045");
    expect(result.output).toContain("Delegated children: $0.001500");
    expect(result.output).toContain("Total recursive: $0.001545");

    const childOnly = await invokeAgent(makeAgent({}), makeTask({ parentTaskId: "parent-1" }), {
      anthropicApiKey: "test",
      systemPromptLoader: async () => "test",
      clientFactory: () => makeClient([textOnly("child final")]),
    });

    expect(childOnly.totalCostUsd).toBe(childOnly.costUsd);
    expect(childOnly.output).toBe("child final");
  });
});

describe("invokeAgent — error paths", () => {
  it("returns failed when ANTHROPIC_API_KEY is missing", async () => {
    const prev = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    try {
      const result = await invokeAgent(makeAgent({}), makeTask(), {
        systemPromptLoader: async () => "test",
        clientFactory: () => makeClient([textOnly("never reached")]),
      });
      expect(result.status).toBe("failed");
      expect(result.error?.code).toBe("missing_anthropic_api_key");
    } finally {
      if (prev !== undefined) process.env.ANTHROPIC_API_KEY = prev;
    }
  });

  it("returns failed when the system-prompt loader throws", async () => {
    const result = await invokeAgent(makeAgent({}), makeTask(), {
      anthropicApiKey: "test",
      systemPromptLoader: async () => {
        throw new Error("cookbook offline");
      },
      clientFactory: () => makeClient([textOnly("never reached")]),
    });
    expect(result.status).toBe("failed");
    expect(result.error?.code).toBe("system_prompt_load_error");
  });

  it("returns failed when the SDK throws", async () => {
    const client: AnthropicClientLike = {
      messages: {
        create: async () => {
          throw new Error("anthropic 500");
        },
      },
    };
    const result = await invokeAgent(makeAgent({}), makeTask(), {
      anthropicApiKey: "test",
      systemPromptLoader: async () => "test",
      clientFactory: () => client,
    });
    expect(result.status).toBe("failed");
    expect(result.error?.code).toBe("anthropic_sdk_error");
  });

  it("cancels via AbortSignal before model turn", async () => {
    const controller = new AbortController();
    controller.abort();
    const result = await invokeAgent(makeAgent({}), makeTask(), {
      anthropicApiKey: "test",
      abortSignal: controller.signal,
      systemPromptLoader: async () => "test",
      clientFactory: () => makeClient([textOnly("never reached")]),
    });
    expect(result.status).toBe("cancelled");
    expect(result.error?.code).toBe("cancelled");
  });
});

describe("invokeAgent — observability", () => {
  it("emits task_started, model_turn, task_completed events", async () => {
    const result = await invokeAgent(makeAgent({}), makeTask(), {
      anthropicApiKey: "test",
      systemPromptLoader: async () => "test",
      clientFactory: () => makeClient([textOnly("ok")]),
    });
    const types = result.eventLog.map((e) => e.type);
    expect(types).toContain("task_started");
    expect(types).toContain("model_turn");
    expect(types).toContain("task_completed");
  });
});
