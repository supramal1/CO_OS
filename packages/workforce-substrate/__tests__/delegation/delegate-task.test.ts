// delegate_task locked-guards tests.
//
// We don't exercise invokeAgent here — we drive the dispatch directly by
// constructing a ToolBuildContext with a stubbed invokeChild. That isolates
// the guards (depth, cycle, canDelegate, reportsTo, self-delegation) from
// the Anthropic SDK loop entirely. The runtime is tested separately in
// __tests__/runtime/.

import { describe, expect, it } from "vitest";
import { buildDelegateTaskTool } from "../../src/integrations/delegation.js";
import {
  MAX_DELEGATION_DEPTH,
  type Agent,
  type EventLog,
  type EventLogEntry,
  type EventType,
  type Task,
  type TaskResult,
  type ToolBuildContext,
  type ToolCallResult,
} from "../../src/types.js";

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

function makeEventLog(): EventLog {
  const buffer: EventLogEntry[] = [];
  let seq = 0;
  return {
    emit(type: EventType, payload: Record<string, unknown>): EventLogEntry {
      const e: EventLogEntry = {
        type,
        timestamp: new Date(0).toISOString(),
        seq: seq++,
        taskId: "test",
        agentId: "test",
        payload,
      };
      buffer.push(e);
      return e;
    },
    entries() {
      return buffer;
    },
  };
}

function makeAgent(overrides: Partial<Agent>): Agent {
  return {
    id: "ada",
    name: "Ada",
    systemPromptSkill: "ada-system-prompt",
    model: "claude-opus-4-7",
    canDelegate: true,
    canUseCornerstoneRead: true,
    canUseCornerstoneWrite: true,
    reportsTo: undefined,
    defaultWorkspace: "aiops",
    toolBuilders: [],
    ...overrides,
  };
}

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: "task-parent",
    description: "parent task",
    targetWorkspace: "aiops",
    parentTaskId: undefined,
    parentAgentId: undefined,
    ancestry: [],
    context: undefined,
    maxCostUsd: undefined,
    ...overrides,
  };
}

function successResult(agentId: string, taskId: string, output = "child output"): TaskResult {
  return {
    taskId,
    agentId,
    status: "completed",
    output,
    eventLog: [],
    costUsd: 0.01,
    durationMs: 12,
    children: [],
  };
}

function makeCtx(opts: {
  parent: Agent;
  parentTask?: Task;
  roster: ReadonlyMap<string, Agent>;
  invokeChild?: ToolBuildContext["invokeChild"];
}): ToolBuildContext {
  return {
    agent: opts.parent,
    task: opts.parentTask ?? makeTask(),
    eventLog: makeEventLog(),
    invokeChild:
      opts.invokeChild ??
      (async (childAgent, childTask) => successResult(childAgent.id, childTask.id)),
    roster: opts.roster,
    anthropicApiKey: "test",
    cornerstoneApiKey: "test",
    cornerstoneApiBaseUrl: "https://example.invalid",
  };
}

// Standard v0 fixture — Ada is Lead, Donald reports to Ada.
const ada: Agent = makeAgent({ id: "ada", name: "Ada", canDelegate: true });
const donald: Agent = makeAgent({
  id: "donald",
  name: "Donald",
  canDelegate: false,
  reportsTo: "ada",
});
const stranger: Agent = makeAgent({
  id: "stranger",
  name: "Stranger",
  canDelegate: false,
  reportsTo: "someone-else",
});

const roster: ReadonlyMap<string, Agent> = new Map([
  ["ada", ada],
  ["donald", donald],
  ["stranger", stranger],
]);

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("delegate_task — happy path", () => {
  it("Ada delegates to Donald and the child result is attached to ToolCallResult", async () => {
    const tool = buildDelegateTaskTool()(makeCtx({ parent: ada, roster }));
    const result = (await tool.dispatch({
      name: "delegate_task",
      toolUseId: "abc",
      input: {
        assigneeAgentName: "donald",
        description: "audit aiops for duplicate facts",
      },
    })) as ToolCallResult & { childResult?: TaskResult };
    expect(result.status).toBe("ok");
    expect(result.childResult?.agentId).toBe("donald");
    expect(result.childResult?.status).toBe("completed");
    const body = result.output as Record<string, unknown>;
    expect(body["status"]).toBe("completed");
    expect(body["assignee"]).toBe("donald");
  });

  it("inherits parent targetWorkspace when not overridden", async () => {
    let captured: Task | undefined;
    const tool = buildDelegateTaskTool()(
      makeCtx({
        parent: ada,
        roster,
        parentTask: makeTask({ targetWorkspace: "aiops" }),
        invokeChild: async (a, t) => {
          captured = t;
          return successResult(a.id, t.id);
        },
      }),
    );
    await tool.dispatch({
      name: "delegate_task",
      toolUseId: "abc",
      input: { assigneeAgentName: "donald", description: "do it" },
    });
    expect(captured?.targetWorkspace).toBe("aiops");
  });

  it("respects explicit targetWorkspace override", async () => {
    let captured: Task | undefined;
    const tool = buildDelegateTaskTool()(
      makeCtx({
        parent: ada,
        roster,
        invokeChild: async (a, t) => {
          captured = t;
          return successResult(a.id, t.id);
        },
      }),
    );
    await tool.dispatch({
      name: "delegate_task",
      toolUseId: "abc",
      input: {
        assigneeAgentName: "donald",
        description: "do it",
        targetWorkspace: "client-paid-media",
      },
    });
    expect(captured?.targetWorkspace).toBe("client-paid-media");
  });

  it("appends parent task id to child ancestry", async () => {
    let captured: Task | undefined;
    const parentTask = makeTask({
      id: "parent-1",
      ancestry: ["root-task"],
    });
    const tool = buildDelegateTaskTool()(
      makeCtx({
        parent: ada,
        roster,
        parentTask,
        invokeChild: async (a, t) => {
          captured = t;
          return successResult(a.id, t.id);
        },
      }),
    );
    await tool.dispatch({
      name: "delegate_task",
      toolUseId: "abc",
      input: { assigneeAgentName: "donald", description: "do it" },
    });
    expect(captured?.ancestry).toEqual(["root-task", "parent-1"]);
    expect(captured?.parentTaskId).toBe("parent-1");
    expect(captured?.parentAgentId).toBe("ada");
  });
});

describe("delegate_task — guard: canDelegate", () => {
  it("blocks dispatch when parent agent is not a Lead", async () => {
    const tool = buildDelegateTaskTool()(makeCtx({ parent: donald, roster }));
    const result = await tool.dispatch({
      name: "delegate_task",
      toolUseId: "abc",
      input: { assigneeAgentName: "ada", description: "anything" },
    });
    expect(result.status).toBe("blocked");
    expect(result.errorCode).toBe("delegation_not_permitted");
  });
});

describe("delegate_task — guard: self-delegation", () => {
  it("rejects Ada delegating to Ada", async () => {
    const tool = buildDelegateTaskTool()(makeCtx({ parent: ada, roster }));
    const result = await tool.dispatch({
      name: "delegate_task",
      toolUseId: "abc",
      input: { assigneeAgentName: "ada", description: "self-handle" },
    });
    expect(result.status).toBe("error");
    expect(result.errorCode).toBe("self_delegation_forbidden");
  });
});

describe("delegate_task — guard: reportsTo", () => {
  it("rejects assignees that don't report to the parent", async () => {
    const tool = buildDelegateTaskTool()(makeCtx({ parent: ada, roster }));
    const result = await tool.dispatch({
      name: "delegate_task",
      toolUseId: "abc",
      input: { assigneeAgentName: "stranger", description: "hi" },
    });
    expect(result.status).toBe("error");
    expect(result.errorCode).toBe("reports_to_violation");
  });
});

describe("delegate_task — guard: depth limit", () => {
  it(`blocks when ancestry would reach depth ${MAX_DELEGATION_DEPTH + 1}`, async () => {
    // ancestry of length MAX_DELEGATION_DEPTH means child's ancestry would be
    // MAX_DELEGATION_DEPTH+1.
    const deep = makeTask({
      id: "deep",
      ancestry: Array.from({ length: MAX_DELEGATION_DEPTH }, (_, i) => `t${i}`),
    });
    const tool = buildDelegateTaskTool()(
      makeCtx({ parent: ada, roster, parentTask: deep }),
    );
    const result = await tool.dispatch({
      name: "delegate_task",
      toolUseId: "abc",
      input: { assigneeAgentName: "donald", description: "go deeper" },
    });
    expect(result.status).toBe("error");
    expect(result.errorCode).toBe("max_depth_exceeded");
  });

  it(`allows ancestry length exactly equal to MAX_DELEGATION_DEPTH-1 (final hop)`, async () => {
    const ok = makeTask({
      id: "ok",
      ancestry: Array.from({ length: MAX_DELEGATION_DEPTH - 1 }, (_, i) => `t${i}`),
    });
    const tool = buildDelegateTaskTool()(
      makeCtx({ parent: ada, roster, parentTask: ok }),
    );
    const result = await tool.dispatch({
      name: "delegate_task",
      toolUseId: "abc",
      input: { assigneeAgentName: "donald", description: "final hop" },
    });
    expect(result.status).toBe("ok");
  });
});

describe("delegate_task — guard: ancestry cycle", () => {
  it("rejects when parent task id already appears in its own ancestry", async () => {
    const cyclic = makeTask({
      id: "loop",
      ancestry: ["loop", "x", "y"],
    });
    const tool = buildDelegateTaskTool()(
      makeCtx({ parent: ada, roster, parentTask: cyclic }),
    );
    const result = await tool.dispatch({
      name: "delegate_task",
      toolUseId: "abc",
      input: { assigneeAgentName: "donald", description: "cycle attempt" },
    });
    expect(result.status).toBe("error");
    expect(result.errorCode).toBe("ancestry_cycle_detected");
  });
});

describe("delegate_task — guard: missing assignee", () => {
  it("returns assignee_not_found for unknown agent name", async () => {
    const tool = buildDelegateTaskTool()(makeCtx({ parent: ada, roster }));
    const result = await tool.dispatch({
      name: "delegate_task",
      toolUseId: "abc",
      input: { assigneeAgentName: "ghost", description: "find me" },
    });
    expect(result.status).toBe("error");
    expect(result.errorCode).toBe("assignee_not_found");
  });
});

describe("delegate_task — input validation", () => {
  it("rejects missing description", async () => {
    const tool = buildDelegateTaskTool()(makeCtx({ parent: ada, roster }));
    const result = await tool.dispatch({
      name: "delegate_task",
      toolUseId: "abc",
      input: { assigneeAgentName: "donald" },
    });
    expect(result.status).toBe("error");
    expect(result.errorCode).toBe("invalid_delegate_input");
  });

  it("rejects empty assigneeAgentName", async () => {
    const tool = buildDelegateTaskTool()(makeCtx({ parent: ada, roster }));
    const result = await tool.dispatch({
      name: "delegate_task",
      toolUseId: "abc",
      input: { assigneeAgentName: "  ", description: "do something" },
    });
    expect(result.status).toBe("error");
    expect(result.errorCode).toBe("invalid_delegate_input");
  });
});

describe("delegate_task — child failure surfaces as error", () => {
  it("translates a failed child TaskResult into a tool_result error", async () => {
    const tool = buildDelegateTaskTool()(
      makeCtx({
        parent: ada,
        roster,
        invokeChild: async (a, t): Promise<TaskResult> => ({
          taskId: t.id,
          agentId: a.id,
          status: "failed",
          output: "",
          eventLog: [],
          costUsd: 0.001,
          durationMs: 5,
          children: [],
          error: { code: "anthropic_sdk_error", message: "rate-limited" },
        }),
      }),
    );
    const result = (await tool.dispatch({
      name: "delegate_task",
      toolUseId: "abc",
      input: { assigneeAgentName: "donald", description: "fail me" },
    })) as ToolCallResult & { childResult?: TaskResult };
    expect(result.status).toBe("error");
    expect(result.errorCode).toBe("anthropic_sdk_error");
    expect(result.childResult?.status).toBe("failed");
  });
});

describe("delegate_task — runtime wiring", () => {
  it("returns roster_unavailable if roster is missing", async () => {
    const ctx: ToolBuildContext = {
      ...makeCtx({ parent: ada, roster }),
      roster: undefined,
    };
    const result = await buildDelegateTaskTool()(ctx).dispatch({
      name: "delegate_task",
      toolUseId: "abc",
      input: { assigneeAgentName: "donald", description: "x" },
    });
    expect(result.errorCode).toBe("roster_unavailable");
  });

  it("returns invoke_child_unavailable if invokeChild is missing", async () => {
    const ctx: ToolBuildContext = {
      ...makeCtx({ parent: ada, roster }),
      invokeChild: undefined,
    };
    const result = await buildDelegateTaskTool()(ctx).dispatch({
      name: "delegate_task",
      toolUseId: "abc",
      input: { assigneeAgentName: "donald", description: "x" },
    });
    expect(result.errorCode).toBe("invoke_child_unavailable");
  });
});
