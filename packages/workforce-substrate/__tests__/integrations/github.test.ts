// GitHub integration tests — pure logic only (namespace guards, forbidden
// tools, env-var resolution). Live API calls are exercised in P7 smoke.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  githubToolForTest,
  GRACE_GITHUB_TOOL_NAMES,
} from "../../src/integrations/github.js";
import type { Agent, Task, ToolBuildContext } from "../../src/types.js";

function makeAgent(): Agent {
  return {
    id: "grace",
    name: "Grace",
    systemPromptSkill: "grace-system-prompt",
    model: "claude-sonnet-4-6",
    canDelegate: false,
    canUseCornerstoneRead: true,
    canUseCornerstoneWrite: true,
    reportsTo: "ada",
    defaultWorkspace: "aiops",
    toolBuilders: [],
  };
}

function makeTask(): Task {
  return {
    id: "task-1",
    description: "test",
    targetWorkspace: "aiops",
    parentTaskId: undefined,
    parentAgentId: undefined,
    ancestry: [],
    context: undefined,
    maxCostUsd: undefined,
  };
}

function makeCtx(): ToolBuildContext {
  return {
    agent: makeAgent(),
    task: makeTask(),
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

const ORIGINAL_PAT = process.env.GRACE_GITHUB_PAT;
const ORIGINAL_ORG = process.env.GRACE_GITHUB_ORG;
const ORIGINAL_PREFIX = process.env.GRACE_BRANCH_PREFIX;

beforeEach(() => {
  process.env.GRACE_GITHUB_PAT = "ghp_test_token";
  process.env.GRACE_GITHUB_ORG = "Forgeautomatedrepo";
  delete process.env.GRACE_BRANCH_PREFIX;
});

afterEach(() => {
  process.env.GRACE_GITHUB_PAT = ORIGINAL_PAT;
  process.env.GRACE_GITHUB_ORG = ORIGINAL_ORG;
  process.env.GRACE_BRANCH_PREFIX = ORIGINAL_PREFIX;
});

describe("github — surface registry", () => {
  it("exports the locked tool surface (10 allowed + 4 forbidden)", () => {
    expect(GRACE_GITHUB_TOOL_NAMES).toHaveLength(14);
    expect(GRACE_GITHUB_TOOL_NAMES).toContain("github_create_repo");
    expect(GRACE_GITHUB_TOOL_NAMES).toContain("github_commit_files");
    expect(GRACE_GITHUB_TOOL_NAMES).toContain("github_open_pr");
    expect(GRACE_GITHUB_TOOL_NAMES).toContain("github_merge_pr");
  });
});

describe("github — env var resolution", () => {
  it("returns github_pat_missing when PAT is absent", async () => {
    delete process.env.GRACE_GITHUB_PAT;
    const fetchMock = vi.fn();
    const tool = githubToolForTest("github_list_repos", fetchMock as unknown as typeof fetch)(
      makeCtx(),
    );
    const result = await tool.dispatch({ name: "github_list_repos", toolUseId: "t", input: {} });
    expect(result.status).toBe("error");
    expect(result.errorCode).toBe("github_pat_missing");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("github — forbidden tools", () => {
  it.each([
    "github_merge_pr",
    "github_delete_repo",
    "github_force_push",
    "github_modify_branch_protection",
  ])("%s returns blocked / permission_denied without making a network call", async (name) => {
    const fetchMock = vi.fn();
    const tool = githubToolForTest(name, fetchMock as unknown as typeof fetch)(makeCtx());
    const result = await tool.dispatch({
      name,
      toolUseId: "t",
      input: { repo: "x", pr_number: 1, branch: "grace/foo" },
    });
    expect(result.status).toBe("blocked");
    expect(result.errorCode).toBe("permission_denied");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("github — branch-namespace guard", () => {
  it("github_create_branch refuses 'main'", async () => {
    const fetchMock = vi.fn();
    const tool = githubToolForTest(
      "github_create_branch",
      fetchMock as unknown as typeof fetch,
    )(makeCtx());
    const result = await tool.dispatch({
      name: "github_create_branch",
      toolUseId: "t",
      input: { repo: "co-experiments", branch: "main" },
    });
    expect(result.status).toBe("error");
    expect(result.errorCode).toBe("branch_protected");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("github_create_branch refuses unprefixed branches", async () => {
    const fetchMock = vi.fn();
    const tool = githubToolForTest(
      "github_create_branch",
      fetchMock as unknown as typeof fetch,
    )(makeCtx());
    const result = await tool.dispatch({
      name: "github_create_branch",
      toolUseId: "t",
      input: { repo: "co-experiments", branch: "feature/foo" },
    });
    expect(result.status).toBe("error");
    expect(result.errorCode).toBe("branch_namespace_violation");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("github_commit_files refuses 'main'", async () => {
    const fetchMock = vi.fn();
    const tool = githubToolForTest(
      "github_commit_files",
      fetchMock as unknown as typeof fetch,
    )(makeCtx());
    const result = await tool.dispatch({
      name: "github_commit_files",
      toolUseId: "t",
      input: {
        repo: "co-experiments",
        branch: "main",
        message: "x",
        files: [{ path: "README.md", content: "x" }],
      },
    });
    expect(result.status).toBe("error");
    expect(result.errorCode).toBe("branch_protected");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("github_open_pr refuses head outside namespace", async () => {
    const fetchMock = vi.fn();
    const tool = githubToolForTest(
      "github_open_pr",
      fetchMock as unknown as typeof fetch,
    )(makeCtx());
    const result = await tool.dispatch({
      name: "github_open_pr",
      toolUseId: "t",
      input: { repo: "co-experiments", head: "feature/foo", title: "x" },
    });
    expect(result.status).toBe("error");
    expect(result.errorCode).toBe("branch_namespace_violation");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("github — happy path with mocked fetch", () => {
  it("github_create_repo POSTs to /orgs/{org}/repos and returns slim metadata", async () => {
    const fetchMock = vi.fn(async (input: unknown, init?: RequestInit) => {
      const url = typeof input === "string" ? input : (input as URL | Request).toString();
      expect(url).toBe("https://api.github.com/orgs/Forgeautomatedrepo/repos");
      expect(init?.method).toBe("POST");
      expect(JSON.parse(init?.body as string)).toMatchObject({
        name: "co-test",
        private: true,
        auto_init: true,
      });
      return jsonResponse(201, {
        name: "co-test",
        full_name: "Forgeautomatedrepo/co-test",
        private: true,
        default_branch: "main",
        html_url: "https://github.com/Forgeautomatedrepo/co-test",
      });
    });
    const tool = githubToolForTest(
      "github_create_repo",
      fetchMock as unknown as typeof fetch,
    )(makeCtx());
    const result = await tool.dispatch({
      name: "github_create_repo",
      toolUseId: "t",
      input: { name: "co-test", description: "smoke" },
    });
    expect(result.status).toBe("ok");
    expect((result.output as Record<string, unknown>).default_branch).toBe("main");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("github_open_pr defaults base to default_branch via repo lookup", async () => {
    const calls: string[] = [];
    const fetchMock = vi.fn(async (input: unknown, init?: RequestInit) => {
      const url = typeof input === "string" ? input : (input as URL | Request).toString();
      calls.push(`${init?.method ?? "GET"} ${url}`);
      if (url.endsWith("/repos/Forgeautomatedrepo/r")) {
        return jsonResponse(200, { default_branch: "main" });
      }
      if (url.endsWith("/repos/Forgeautomatedrepo/r/pulls")) {
        const body = JSON.parse(init?.body as string);
        expect(body.base).toBe("main");
        expect(body.head).toBe("grace/foo");
        return jsonResponse(201, {
          number: 1,
          state: "open",
          html_url: "https://github.com/x/r/pull/1",
          draft: false,
        });
      }
      throw new Error(`unexpected url ${url}`);
    });
    const tool = githubToolForTest(
      "github_open_pr",
      fetchMock as unknown as typeof fetch,
    )(makeCtx());
    const result = await tool.dispatch({
      name: "github_open_pr",
      toolUseId: "t",
      input: { repo: "r", head: "grace/foo", title: "T" },
    });
    expect(result.status).toBe("ok");
    expect((result.output as Record<string, unknown>).number).toBe(1);
    expect(calls).toHaveLength(2);
  });
});
