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

function makeCtx(overrides: Partial<ToolBuildContext> = {}): ToolBuildContext {
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
    graceGithubPat: "ghp_test_token",
    graceGithubOrg: "Forgeautomatedrepo",
    graceGithubBranchPrefix: "grace/",
    ...overrides,
  };
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

// Note: PAT/org/prefix are now threaded via ToolBuildContext (see makeCtx).
// Tests that need to simulate "no PAT configured" pass `graceGithubPat: undefined`
// to makeCtx — they no longer mutate process.env. The substrate boundary
// (claude-agent.ts) is the only place that reads process.env for these values.
const ORIGINAL_PAT = process.env.GRACE_GITHUB_PAT;
const ORIGINAL_ORG = process.env.GRACE_GITHUB_ORG;
const ORIGINAL_PREFIX = process.env.GRACE_BRANCH_PREFIX;

beforeEach(() => {
  // Strip env so any accidental process.env read inside the substrate is
  // immediately visible — dispatchers must source config from ctx, not env.
  delete process.env.GRACE_GITHUB_PAT;
  delete process.env.GRACE_GITHUB_ORG;
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

describe("github — ctx-based config resolution", () => {
  it("returns github_pat_missing when ctx.graceGithubPat is absent", async () => {
    const fetchMock = vi.fn();
    const tool = githubToolForTest("github_list_repos", fetchMock as unknown as typeof fetch)(
      makeCtx({ graceGithubPat: undefined }),
    );
    const result = await tool.dispatch({ name: "github_list_repos", toolUseId: "t", input: {} });
    expect(result.status).toBe("error");
    expect(result.errorCode).toBe("github_pat_missing");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("ignores process.env.GRACE_GITHUB_PAT — config flows only through ctx", async () => {
    process.env.GRACE_GITHUB_PAT = "ghp_should_not_be_read";
    const fetchMock = vi.fn();
    const tool = githubToolForTest("github_list_repos", fetchMock as unknown as typeof fetch)(
      makeCtx({ graceGithubPat: undefined }),
    );
    const result = await tool.dispatch({ name: "github_list_repos", toolUseId: "t", input: {} });
    expect(result.status).toBe("error");
    expect(result.errorCode).toBe("github_pat_missing");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("uses ctx.graceGithubOrg for the org slug in the URL", async () => {
    const fetchMock = vi.fn(async (input: unknown) => {
      const url = typeof input === "string" ? input : (input as URL | Request).toString();
      expect(url.startsWith("https://api.github.com/orgs/CustomOrg/")).toBe(true);
      return jsonResponse(200, []);
    });
    const tool = githubToolForTest(
      "github_list_repos",
      fetchMock as unknown as typeof fetch,
    )(makeCtx({ graceGithubOrg: "CustomOrg" }));
    const result = await tool.dispatch({
      name: "github_list_repos",
      toolUseId: "t",
      input: {},
    });
    expect(result.status).toBe("ok");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("uses ctx.graceGithubBranchPrefix in namespace guard error message", async () => {
    const fetchMock = vi.fn();
    const tool = githubToolForTest(
      "github_create_branch",
      fetchMock as unknown as typeof fetch,
    )(makeCtx({ graceGithubBranchPrefix: "agent/" }));
    const result = await tool.dispatch({
      name: "github_create_branch",
      toolUseId: "t",
      input: { repo: "r", branch: "grace/foo" },
    });
    expect(result.status).toBe("error");
    expect(result.errorCode).toBe("branch_namespace_violation");
    expect(result.errorMessage).toContain("agent/");
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

  it("github_commit_files refuses 'main' when main already exists", async () => {
    // Bootstrap path is reachable only when main 404s (empty repo). When
    // main already exists, the namespace guard fires after the cheap ref
    // probe — protecting existing history from direct writes.
    const fetchMock = vi.fn(async () =>
      jsonResponse(200, {
        ref: "refs/heads/main",
        object: { sha: "existing-main-sha", type: "commit" },
      }),
    );
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
    // Exactly one call — the ref probe — before the guard rejects.
    expect(fetchMock).toHaveBeenCalledTimes(1);
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
  it("github_create_repo defaults auto_init to false (Grace owns the first commit)", async () => {
    const fetchMock = vi.fn(async (input: unknown, init?: RequestInit) => {
      const url = typeof input === "string" ? input : (input as URL | Request).toString();
      expect(url).toBe("https://api.github.com/orgs/Forgeautomatedrepo/repos");
      expect(init?.method).toBe("POST");
      expect(JSON.parse(init?.body as string)).toMatchObject({
        name: "co-test",
        private: true,
        auto_init: false,
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

  it("github_create_repo honours auto_init=true when explicitly set", async () => {
    const fetchMock = vi.fn(async (_input: unknown, init?: RequestInit) => {
      expect(JSON.parse(init?.body as string)).toMatchObject({ auto_init: true });
      return jsonResponse(201, { name: "co-test", default_branch: "main" });
    });
    const tool = githubToolForTest(
      "github_create_repo",
      fetchMock as unknown as typeof fetch,
    )(makeCtx());
    const result = await tool.dispatch({
      name: "github_create_repo",
      toolUseId: "t",
      input: { name: "co-test", auto_init: true },
    });
    expect(result.status).toBe("ok");
  });

  it("github_commit_files bootstrap: creates orphan commit + ref when main 404s", async () => {
    // Sequence:
    //   1. GET /git/ref/heads/main         → 404 (empty repo)
    //   2. POST /git/blobs                 → blob sha
    //   3. POST /git/trees   (no base_tree) → tree sha
    //   4. POST /git/commits (parents: []) → commit sha
    //   5. POST /git/refs    (refs/heads/main) → 201
    const fetchMock = vi.fn(async (input: unknown, init?: RequestInit) => {
      const url = typeof input === "string" ? input : (input as URL | Request).toString();
      const method = init?.method ?? "GET";
      const body = init?.body ? JSON.parse(init.body as string) : null;

      if (method === "GET" && url.endsWith("/repos/Forgeautomatedrepo/r/git/ref/heads/main")) {
        return jsonResponse(404, { message: "Not Found" });
      }
      if (method === "POST" && url.endsWith("/repos/Forgeautomatedrepo/r/git/blobs")) {
        expect(body).toEqual({ content: "hello", encoding: "utf-8" });
        return jsonResponse(201, { sha: "blob-sha-1" });
      }
      if (method === "POST" && url.endsWith("/repos/Forgeautomatedrepo/r/git/trees")) {
        // base_tree must be ABSENT in bootstrap mode
        expect(body).not.toHaveProperty("base_tree");
        expect(body.tree).toEqual([
          { path: "README.md", mode: "100644", type: "blob", sha: "blob-sha-1" },
        ]);
        return jsonResponse(201, { sha: "tree-sha-1" });
      }
      if (method === "POST" && url.endsWith("/repos/Forgeautomatedrepo/r/git/commits")) {
        // parents must be empty (orphan commit)
        expect(body.parents).toEqual([]);
        expect(body.tree).toBe("tree-sha-1");
        return jsonResponse(201, {
          sha: "commit-sha-1",
          html_url: "https://github.com/Forgeautomatedrepo/r/commit/commit-sha-1",
        });
      }
      if (method === "POST" && url.endsWith("/repos/Forgeautomatedrepo/r/git/refs")) {
        // POST not PATCH — creating the ref for the first time
        expect(body).toEqual({ ref: "refs/heads/main", sha: "commit-sha-1" });
        return jsonResponse(201, { ref: "refs/heads/main", object: { sha: "commit-sha-1" } });
      }
      throw new Error(`unexpected ${method} ${url}`);
    });
    const tool = githubToolForTest(
      "github_commit_files",
      fetchMock as unknown as typeof fetch,
    )(makeCtx());
    const result = await tool.dispatch({
      name: "github_commit_files",
      toolUseId: "t",
      input: {
        repo: "r",
        branch: "main",
        message: "initial commit",
        files: [{ path: "README.md", content: "hello" }],
      },
    });
    expect(result.status).toBe("ok");
    expect((result.output as Record<string, unknown>).bootstrap).toBe(true);
    expect((result.output as Record<string, unknown>).commit_sha).toBe("commit-sha-1");
  });

  it("github_commit_files bootstrap: rejects deletions (no parent tree)", async () => {
    const fetchMock = vi.fn(async (input: unknown) => {
      const url = typeof input === "string" ? input : (input as URL | Request).toString();
      if (url.endsWith("/repos/Forgeautomatedrepo/r/git/ref/heads/main")) {
        return jsonResponse(404, { message: "Not Found" });
      }
      throw new Error(`unexpected url ${url}`);
    });
    const tool = githubToolForTest(
      "github_commit_files",
      fetchMock as unknown as typeof fetch,
    )(makeCtx());
    const result = await tool.dispatch({
      name: "github_commit_files",
      toolUseId: "t",
      input: {
        repo: "r",
        branch: "main",
        message: "x",
        files: [{ path: "README.md", content: "y" }],
        deletions: ["old.md"],
      },
    });
    expect(result.status).toBe("error");
    expect(result.errorCode).toBe("invalid_input");
    expect(result.errorMessage).toContain("bootstrap");
  });

  it("github_commit_files: non-default branches outside namespace fail-fast without HTTP", async () => {
    // Bootstrap is gated to main/master only — feature/x must hit the
    // namespace guard before any API call so a stray bootstrap path can't
    // be forged on a non-default branch.
    const fetchMock = vi.fn();
    const tool = githubToolForTest(
      "github_commit_files",
      fetchMock as unknown as typeof fetch,
    )(makeCtx());
    const result = await tool.dispatch({
      name: "github_commit_files",
      toolUseId: "t",
      input: {
        repo: "r",
        branch: "feature/x",
        message: "x",
        files: [{ path: "a.md", content: "y" }],
      },
    });
    expect(result.status).toBe("error");
    expect(result.errorCode).toBe("branch_namespace_violation");
    expect(fetchMock).not.toHaveBeenCalled();
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
