#!/usr/bin/env node
// Live smoke for Grace's GitHub tool surface.
//
// Exercises every ALLOWED tool against real GitHub using the configured
// GRACE_GITHUB_PAT. Creates a test repo in the configured org, branches,
// commits, opens a PR, comments. Leaves the repo behind for Mal to inspect
// or delete via the GitHub UI (delete_repo is forbidden by design).
//
// Usage: npx tsx bin/smoke-github.ts
//
// Env:
//   GRACE_GITHUB_PAT     Required.
//   GRACE_GITHUB_ORG     Optional, defaults to Forgeautomatedrepo.
//   GRACE_BRANCH_PREFIX  Optional, defaults to grace/.
//
// Exit code: 0 on full pass, 1 on any tool failure.

import {
  GRACE_GITHUB_TOOL_NAMES,
  githubTool,
} from "../src/integrations/github.js";
import type { ToolBuildContext } from "../src/types.js";

const REPO_NAME = `co-substrate-smoke-${new Date().toISOString().slice(0, 10)}-${Math.random().toString(16).slice(2, 6)}`;
const BRANCH = `grace/smoke-${Date.now()}`;

function makeCtx(): ToolBuildContext {
  return {
    agent: {
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
    },
    task: {
      id: "smoke-task",
      description: "smoke test",
      targetWorkspace: "aiops",
      parentTaskId: undefined,
      parentAgentId: undefined,
      ancestry: [],
      context: undefined,
      maxCostUsd: undefined,
    },
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
    anthropicApiKey: "unused",
    cornerstoneApiKey: "unused",
    cornerstoneApiBaseUrl: "unused",
  };
}

interface Step {
  name: string;
  call: () => Promise<{ ok: boolean; summary: string; raw?: unknown }>;
}

let prNumber = 0;

async function call(name: string, input: Record<string, unknown>) {
  const ctx = makeCtx();
  const tool = githubTool(name)(ctx);
  return await tool.dispatch({ name, toolUseId: "smoke", input });
}

async function step(label: string, fn: () => Promise<unknown>): Promise<boolean> {
  process.stdout.write(`→ ${label} ... `);
  try {
    const out = await fn();
    process.stdout.write(`ok\n`);
    if (process.env.DEBUG) console.dir(out, { depth: 4 });
    return true;
  } catch (err) {
    process.stdout.write(`FAIL\n`);
    console.error(`  error: ${err instanceof Error ? err.message : String(err)}`);
    return false;
  }
}

function unwrap(label: string, r: { status: string; output?: unknown; errorMessage?: string }): unknown {
  if (r.status !== "ok") {
    throw new Error(`${label} returned status=${r.status}: ${r.errorMessage ?? "no message"}`);
  }
  return r.output;
}

async function main() {
  console.log(`# Grace GitHub smoke`);
  console.log(`org    : ${process.env.GRACE_GITHUB_ORG ?? "Forgeautomatedrepo"}`);
  console.log(`repo   : ${REPO_NAME}`);
  console.log(`branch : ${BRANCH}`);
  console.log(`tools  : ${GRACE_GITHUB_TOOL_NAMES.join(", ")}`);
  console.log(``);

  const results: boolean[] = [];

  results.push(
    await step("github_list_repos (read-only)", async () => {
      const out = unwrap("list_repos", await call("github_list_repos", { per_page: 5 })) as {
        count: number;
      };
      if (typeof out.count !== "number") throw new Error("missing count");
    }),
  );

  results.push(
    await step(`github_create_repo (private, auto_init) → ${REPO_NAME}`, async () => {
      unwrap(
        "create_repo",
        await call("github_create_repo", {
          name: REPO_NAME,
          description: "Smoke test for Grace GitHub tool surface — safe to delete.",
        }),
      );
    }),
  );

  results.push(
    await step("github_get_repo confirms default_branch", async () => {
      const out = unwrap("get_repo", await call("github_get_repo", { repo: REPO_NAME })) as {
        default_branch?: string;
      };
      if (out.default_branch !== "main") {
        throw new Error(`expected default_branch=main, got ${out.default_branch}`);
      }
    }),
  );

  results.push(
    await step(`github_create_branch ${BRANCH}`, async () => {
      unwrap(
        "create_branch",
        await call("github_create_branch", { repo: REPO_NAME, branch: BRANCH }),
      );
    }),
  );

  results.push(
    await step("github_create_branch refuses 'main' (guard)", async () => {
      const r = await call("github_create_branch", { repo: REPO_NAME, branch: "main" });
      if (r.status !== "error" || r.errorCode !== "branch_protected") {
        throw new Error(`expected branch_protected error, got status=${r.status} code=${r.errorCode}`);
      }
    }),
  );

  results.push(
    await step("github_commit_files (multi-file atomic)", async () => {
      unwrap(
        "commit_files",
        await call("github_commit_files", {
          repo: REPO_NAME,
          branch: BRANCH,
          message: "smoke: add SMOKE.md and notes/log.md",
          files: [
            {
              path: "SMOKE.md",
              content: `# Smoke\n\nGenerated by smoke-github.ts on ${new Date().toISOString()}.\n`,
            },
            { path: "notes/log.md", content: "first entry\n" },
          ],
        }),
      );
    }),
  );

  results.push(
    await step("github_read_file confirms SMOKE.md", async () => {
      const out = unwrap(
        "read_file",
        await call("github_read_file", { repo: REPO_NAME, path: "SMOKE.md", ref: BRANCH }),
      ) as { content: string };
      if (!out.content.includes("Smoke")) throw new Error("file content missing 'Smoke'");
    }),
  );

  results.push(
    await step("github_list_branches sees Grace's branch", async () => {
      const out = unwrap(
        "list_branches",
        await call("github_list_branches", { repo: REPO_NAME }),
      ) as { branches: Array<{ name: string }> };
      if (!out.branches.some((b) => b.name === BRANCH)) {
        throw new Error(`branch ${BRANCH} not found in list`);
      }
    }),
  );

  results.push(
    await step("github_open_pr (head=grace/..., base=default)", async () => {
      const out = unwrap(
        "open_pr",
        await call("github_open_pr", {
          repo: REPO_NAME,
          head: BRANCH,
          title: "Smoke PR — Grace GitHub tool surface",
          body: "End-to-end smoke for the Night-1 GitHub tool family. Safe to close without merging.",
        }),
      ) as { number: number };
      prNumber = out.number;
    }),
  );

  results.push(
    await step("github_open_pr refuses head outside namespace (guard)", async () => {
      const r = await call("github_open_pr", {
        repo: REPO_NAME,
        head: "main",
        title: "should be rejected",
      });
      if (r.status !== "error" || r.errorCode !== "branch_protected") {
        throw new Error(`expected branch_protected, got status=${r.status} code=${r.errorCode}`);
      }
    }),
  );

  results.push(
    await step(`github_read_pr_status PR#${prNumber}`, async () => {
      const out = unwrap(
        "read_pr_status",
        await call("github_read_pr_status", { repo: REPO_NAME, pr_number: prNumber }),
      ) as { state?: string };
      if (out.state !== "open") throw new Error(`expected state=open, got ${out.state}`);
    }),
  );

  results.push(
    await step(`github_comment_on_pr PR#${prNumber}`, async () => {
      unwrap(
        "comment_on_pr",
        await call("github_comment_on_pr", {
          repo: REPO_NAME,
          pr_number: prNumber,
          body: "Smoke comment from substrate. Safe to ignore.",
        }),
      );
    }),
  );

  results.push(
    await step("github_merge_pr returns permission_denied (forbidden)", async () => {
      const r = await call("github_merge_pr", { repo: REPO_NAME, pr_number: prNumber });
      if (r.status !== "blocked" || r.errorCode !== "permission_denied") {
        throw new Error(`expected blocked/permission_denied, got status=${r.status} code=${r.errorCode}`);
      }
    }),
  );

  console.log(``);
  const failed = results.filter((r) => !r).length;
  console.log(`Result: ${results.length - failed}/${results.length} steps passed`);
  console.log(``);
  console.log(`Repo created: https://github.com/${process.env.GRACE_GITHUB_ORG ?? "Forgeautomatedrepo"}/${REPO_NAME}`);
  console.log(`PR opened   : #${prNumber} (still open — Mal can review/close via the UI)`);
  console.log(``);
  console.log(`The repo is safe to delete via the GitHub UI (Grace cannot delete it — by design).`);

  process.exit(failed === 0 ? 0 : 1);
}

void main().catch((err) => {
  console.error(err);
  process.exit(2);
});
