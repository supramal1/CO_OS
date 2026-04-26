// GitHub tools for Grace.
//
// Pure REST-API surface — every tool is a stateless HTTP call. No working
// directories, no shelling out to `git`, no per-task scratch disk. This keeps
// tool calls idempotent-friendly and Cloud-Run-safe (no writable filesystem
// assumptions) and matches the cornerstone integration's design.
//
// Auth: process-level Personal Access Token, read at dispatch time from
// `process.env.GRACE_GITHUB_PAT`. Org is pinned via `process.env.GRACE_GITHUB_ORG`
// (defaults to "Forgeautomatedrepo" per the Phase 5 decision record). Both env
// vars are read lazily so a missing key produces a clear `permission_denied`
// error rather than blowing up roster construction.
//
// Tool surface deviation from grace-github-tools-decisions.md:
//   - Dropped `clone_repo` and `push` (meaningless in pure-API model — every
//     write is its own atomic commit, no local working copy).
//   - Added `github_get_repo` (cheap pre-flight for default branch / metadata).
//   - Added `github_commit_files` (atomic multi-file commit via git-data API,
//     so Grace can land a coherent change as one commit instead of N).
// Forbidden tools are still mounted (returning `permission_denied`) so Grace
// learns they exist but can't be used — same pattern as Donald + steward_apply.
//
// Branch-namespace invariant: any tool that mutates a branch refuses to act on
// `main` or any branch outside `grace/...` (configurable via
// GRACE_BRANCH_PREFIX, defaults to "grace/"). The PR `head` field must also
// resolve to an allowed branch. Surfaces as `permission_denied` from the tool,
// not a remote 403, so the audit trail is local and clear.

import type {
  Tool,
  ToolBuildContext,
  ToolBuilder,
  ToolCallInput,
  ToolCallResult,
  ToolSpec,
} from "../types.js";

// ---------------------------------------------------------------------------
// Tool name registry
// ---------------------------------------------------------------------------

const ALLOWED_TOOL_NAMES = [
  "github_list_repos",
  "github_create_repo",
  "github_get_repo",
  "github_list_branches",
  "github_create_branch",
  "github_read_file",
  "github_commit_files",
  "github_open_pr",
  "github_read_pr_status",
  "github_comment_on_pr",
] as const;

const FORBIDDEN_TOOL_NAMES = [
  "github_merge_pr",
  "github_delete_repo",
  "github_force_push",
  "github_modify_branch_protection",
] as const;

export const GRACE_GITHUB_TOOL_NAMES: readonly string[] = [
  ...ALLOWED_TOOL_NAMES,
  ...FORBIDDEN_TOOL_NAMES,
];

const FORBIDDEN_RATIONALE: Readonly<Record<string, string>> = {
  github_merge_pr:
    "Mal merges via the GitHub UI. Grace opens PRs but never merges them.",
  github_delete_repo:
    "Repo deletion is destructive and irreversible — Mal-only via GitHub UI.",
  github_force_push:
    "Force-push rewrites history. Grace pushes by opening a fresh PR; Mal handles history surgery.",
  github_modify_branch_protection:
    "Branch protection rules are policy — Mal-only via GitHub UI.",
};

// ---------------------------------------------------------------------------
// Tool spec builders
// ---------------------------------------------------------------------------

function buildSpecs(): Record<string, ToolSpec> {
  const repoField = {
    type: "string",
    description: "Repository name within the configured org (no owner prefix).",
  } as const;
  const branchField = {
    type: "string",
    description:
      "Branch name. Must be in the grace/ namespace for any write operation.",
  } as const;

  return {
    github_list_repos: {
      name: "github_list_repos",
      description:
        "List repositories in the configured org. Returns name, default_branch, private, description, html_url. Read-only.",
      input_schema: {
        type: "object",
        properties: {
          per_page: { type: "integer", description: "Page size 1-100. Default 30." },
          page: { type: "integer", description: "Page number, 1-indexed. Default 1." },
        },
        required: [],
      },
    },
    github_create_repo: {
      name: "github_create_repo",
      description:
        "Create a new repository in the configured org. Defaults: visibility=private, init=true (with empty README so the default branch exists). Pass visibility='public' explicitly to publish.",
      input_schema: {
        type: "object",
        properties: {
          name: { type: "string", description: "Repo slug (lowercase-kebab)." },
          description: { type: "string", description: "Short description." },
          visibility: {
            type: "string",
            description: "private (default) or public.",
          },
        },
        required: ["name"],
      },
    },
    github_get_repo: {
      name: "github_get_repo",
      description:
        "Fetch repo metadata (default_branch, latest commit, etc.). Useful before creating a branch so you know which base to branch off.",
      input_schema: {
        type: "object",
        properties: { repo: repoField },
        required: ["repo"],
      },
    },
    github_list_branches: {
      name: "github_list_branches",
      description:
        "List branches in a repo. Read-only. Use before creating a new branch to avoid collisions.",
      input_schema: {
        type: "object",
        properties: {
          repo: repoField,
          per_page: { type: "integer", description: "Page size 1-100. Default 30." },
          page: { type: "integer", description: "Page number, 1-indexed. Default 1." },
        },
        required: ["repo"],
      },
    },
    github_create_branch: {
      name: "github_create_branch",
      description:
        "Create a new branch off the repo's default branch. Branch name MUST be in the grace/ namespace.",
      input_schema: {
        type: "object",
        properties: {
          repo: repoField,
          branch: {
            type: "string",
            description: "New branch name. Must start with 'grace/'.",
          },
          from_branch: {
            type: "string",
            description:
              "Optional source branch. Defaults to the repo's default branch. Must NOT be 'main' as a write target — this is a source-only field.",
          },
        },
        required: ["repo", "branch"],
      },
    },
    github_read_file: {
      name: "github_read_file",
      description:
        "Read a file's contents from a repo at a given branch or sha. Returns text decoded from base64.",
      input_schema: {
        type: "object",
        properties: {
          repo: repoField,
          path: { type: "string", description: "File path relative to repo root." },
          ref: {
            type: "string",
            description: "Branch name or commit sha. Defaults to the default branch.",
          },
        },
        required: ["repo", "path"],
      },
    },
    github_commit_files: {
      name: "github_commit_files",
      description:
        "Atomic multi-file commit on a Grace branch. Provide an array of file edits (path + content); a single commit is created with all of them. Branch must be in the grace/ namespace and must already exist (call github_create_branch first).",
      input_schema: {
        type: "object",
        properties: {
          repo: repoField,
          branch: {
            type: "string",
            description: "Target branch (must start with 'grace/').",
          },
          message: { type: "string", description: "Commit message." },
          files: {
            type: "array",
            description:
              "Array of { path: string, content: string, encoding?: 'utf-8' | 'base64' (default utf-8) }.",
          },
          deletions: {
            type: "array",
            description:
              "Optional array of file paths to delete in the same commit. Strings.",
          },
        },
        required: ["repo", "branch", "message", "files"],
      },
    },
    github_open_pr: {
      name: "github_open_pr",
      description:
        "Open a pull request from a Grace branch into the repo's default branch. Returns the PR number and html_url.",
      input_schema: {
        type: "object",
        properties: {
          repo: repoField,
          head: branchField,
          title: { type: "string", description: "PR title." },
          body: { type: "string", description: "PR description (markdown)." },
          base: {
            type: "string",
            description:
              "Optional base branch. Defaults to the repo's default branch. Setting base != default is allowed (e.g. PR-stacking).",
          },
          draft: {
            type: "boolean",
            description: "Open as a draft PR. Default false.",
          },
        },
        required: ["repo", "head", "title"],
      },
    },
    github_read_pr_status: {
      name: "github_read_pr_status",
      description:
        "Fetch a PR's current state (open/closed/merged), review status, and last comment summary. Read-only.",
      input_schema: {
        type: "object",
        properties: {
          repo: repoField,
          pr_number: { type: "integer", description: "PR number." },
        },
        required: ["repo", "pr_number"],
      },
    },
    github_comment_on_pr: {
      name: "github_comment_on_pr",
      description:
        "Post a comment on a PR. Use for follow-ups after Mal asks for changes within the same task.",
      input_schema: {
        type: "object",
        properties: {
          repo: repoField,
          pr_number: { type: "integer", description: "PR number." },
          body: { type: "string", description: "Comment body (markdown)." },
        },
        required: ["repo", "pr_number", "body"],
      },
    },

    // Forbidden — always return permission_denied. Specs minimal so the
    // model sees the name but isn't tempted to engineer around them.
    github_merge_pr: {
      name: "github_merge_pr",
      description: "Forbidden in v0 — Mal merges via the GitHub UI. Calls return permission_denied.",
      input_schema: {
        type: "object",
        properties: {
          repo: { type: "string" },
          pr_number: { type: "integer" },
        },
        required: ["repo", "pr_number"],
      },
    },
    github_delete_repo: {
      name: "github_delete_repo",
      description: "Forbidden — destructive, never. Calls return permission_denied.",
      input_schema: {
        type: "object",
        properties: { repo: { type: "string" } },
        required: ["repo"],
      },
    },
    github_force_push: {
      name: "github_force_push",
      description: "Forbidden — never. Calls return permission_denied.",
      input_schema: {
        type: "object",
        properties: {
          repo: { type: "string" },
          branch: { type: "string" },
        },
        required: ["repo", "branch"],
      },
    },
    github_modify_branch_protection: {
      name: "github_modify_branch_protection",
      description:
        "Forbidden — branch protection is policy, Mal-only. Calls return permission_denied.",
      input_schema: {
        type: "object",
        properties: { repo: { type: "string" } },
        required: ["repo"],
      },
    },
  };
}

const SPECS = buildSpecs();

// ---------------------------------------------------------------------------
// Runtime — closes over PAT, org, fetch.
// ---------------------------------------------------------------------------

interface GitHubRuntime {
  readonly fetchImpl: typeof fetch;
  readonly token: string;
  readonly org: string;
  readonly branchPrefix: string;
}

interface GitHubRuntimeOrError {
  readonly rt?: GitHubRuntime;
  readonly error?: ToolCallResult;
}

function makeRuntime(fetchImpl?: typeof fetch): GitHubRuntimeOrError {
  const token = process.env.GRACE_GITHUB_PAT;
  if (!token) {
    return {
      error: {
        status: "error",
        output: null,
        errorCode: "github_pat_missing",
        errorMessage:
          "GRACE_GITHUB_PAT is not set. Configure the substrate with a PAT scoped to the configured org before invoking GitHub tools.",
      },
    };
  }
  const org = process.env.GRACE_GITHUB_ORG ?? "Forgeautomatedrepo";
  const branchPrefix = process.env.GRACE_BRANCH_PREFIX ?? "grace/";
  return {
    rt: {
      fetchImpl: fetchImpl ?? fetch,
      token,
      org,
      branchPrefix,
    },
  };
}

// ---------------------------------------------------------------------------
// HTTP helper
// ---------------------------------------------------------------------------

interface GhOk {
  readonly ok: true;
  readonly status: number;
  readonly body: unknown;
}
interface GhErr {
  readonly ok: false;
  readonly status: number;
  readonly body: unknown;
}

async function ghCall(
  rt: GitHubRuntime,
  method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE",
  path: string,
  options: { body?: unknown; query?: Record<string, string | number | undefined> } = {},
): Promise<GhOk | GhErr> {
  const url = new URL(`https://api.github.com${path}`);
  if (options.query) {
    for (const [k, v] of Object.entries(options.query)) {
      if (v !== undefined && v !== "") url.searchParams.set(k, String(v));
    }
  }
  const res = await rt.fetchImpl(url.toString(), {
    method,
    headers: {
      Authorization: `Bearer ${rt.token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "co-workforce-substrate/0.0.1",
      ...(options.body !== undefined ? { "content-type": "application/json" } : {}),
    },
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });
  const raw = await res.text();
  let parsed: unknown = raw;
  if (raw.length > 0) {
    try {
      parsed = JSON.parse(raw);
    } catch {
      // keep as string
    }
  }
  if (!res.ok) return { ok: false, status: res.status, body: parsed };
  return { ok: true, status: res.status, body: parsed };
}

function ghErrorMessage(body: unknown): string {
  if (body && typeof body === "object") {
    const r = body as Record<string, unknown>;
    if (typeof r.message === "string") return r.message;
  }
  if (typeof body === "string" && body.length > 0) return body;
  return "GitHub API error";
}

function mapGhError(res: GhErr): ToolCallResult {
  return {
    status: "error",
    output: { status: res.status, body: res.body },
    errorCode: res.status === 404 ? "github_not_found" : "github_api_error",
    errorMessage: ghErrorMessage(res.body),
  };
}

// ---------------------------------------------------------------------------
// Input parsing
// ---------------------------------------------------------------------------

function asStr(v: unknown): string | null {
  return typeof v === "string" && v.trim().length > 0 ? v : null;
}
function asOptStr(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}
function asOptInt(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? Math.trunc(v) : null;
}
function asOptBool(v: unknown): boolean | null {
  return typeof v === "boolean" ? v : null;
}

function requireBranchInNamespace(
  rt: GitHubRuntime,
  branch: string,
  fieldName: string,
): ToolCallResult | null {
  if (branch === "main" || branch === "master") {
    return {
      status: "error",
      output: null,
      errorCode: "branch_protected",
      errorMessage: `${fieldName}='${branch}' is a protected branch. Grace only writes to branches under '${rt.branchPrefix}'.`,
    };
  }
  if (!branch.startsWith(rt.branchPrefix)) {
    return {
      status: "error",
      output: null,
      errorCode: "branch_namespace_violation",
      errorMessage: `${fieldName}='${branch}' is outside the allowed namespace '${rt.branchPrefix}'. Pick a branch name like '${rt.branchPrefix}<topic>'.`,
    };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Per-tool dispatchers
// ---------------------------------------------------------------------------

async function listRepos(rt: GitHubRuntime, input: Record<string, unknown>): Promise<ToolCallResult> {
  const res = await ghCall(rt, "GET", `/orgs/${encodeURIComponent(rt.org)}/repos`, {
    query: {
      per_page: asOptInt(input.per_page) ?? 30,
      page: asOptInt(input.page) ?? 1,
    },
  });
  if (!res.ok) return mapGhError(res);
  const repos = Array.isArray(res.body) ? res.body : [];
  const slim = repos.map((r) => {
    const o = r as Record<string, unknown>;
    return {
      name: o.name,
      description: o.description,
      private: o.private,
      default_branch: o.default_branch,
      html_url: o.html_url,
      updated_at: o.updated_at,
    };
  });
  return { status: "ok", output: { repos: slim, count: slim.length } };
}

async function createRepo(rt: GitHubRuntime, input: Record<string, unknown>): Promise<ToolCallResult> {
  const name = asStr(input.name);
  if (!name)
    return {
      status: "error",
      output: null,
      errorCode: "invalid_input",
      errorMessage: "github_create_repo requires `name`.",
    };
  const visibility = (asOptStr(input.visibility) ?? "private").toLowerCase();
  if (visibility !== "private" && visibility !== "public")
    return {
      status: "error",
      output: null,
      errorCode: "invalid_input",
      errorMessage: `visibility must be 'private' or 'public', got '${visibility}'.`,
    };
  const res = await ghCall(rt, "POST", `/orgs/${encodeURIComponent(rt.org)}/repos`, {
    body: {
      name,
      description: asOptStr(input.description) ?? undefined,
      private: visibility === "private",
      auto_init: true,
    },
  });
  if (!res.ok) return mapGhError(res);
  const r = res.body as Record<string, unknown>;
  return {
    status: "ok",
    output: {
      name: r.name,
      full_name: r.full_name,
      private: r.private,
      default_branch: r.default_branch,
      html_url: r.html_url,
    },
  };
}

async function getRepo(rt: GitHubRuntime, input: Record<string, unknown>): Promise<ToolCallResult> {
  const repo = asStr(input.repo);
  if (!repo) return invalidInput("github_get_repo requires `repo`.");
  const res = await ghCall(rt, "GET", `/repos/${encodeURIComponent(rt.org)}/${encodeURIComponent(repo)}`);
  if (!res.ok) return mapGhError(res);
  const r = res.body as Record<string, unknown>;
  return {
    status: "ok",
    output: {
      name: r.name,
      full_name: r.full_name,
      private: r.private,
      default_branch: r.default_branch,
      html_url: r.html_url,
      description: r.description,
      pushed_at: r.pushed_at,
    },
  };
}

async function listBranches(rt: GitHubRuntime, input: Record<string, unknown>): Promise<ToolCallResult> {
  const repo = asStr(input.repo);
  if (!repo) return invalidInput("github_list_branches requires `repo`.");
  const res = await ghCall(rt, "GET", `/repos/${encodeURIComponent(rt.org)}/${encodeURIComponent(repo)}/branches`, {
    query: {
      per_page: asOptInt(input.per_page) ?? 30,
      page: asOptInt(input.page) ?? 1,
    },
  });
  if (!res.ok) return mapGhError(res);
  const branches = Array.isArray(res.body) ? res.body : [];
  const slim = branches.map((b) => {
    const o = b as Record<string, unknown>;
    const c = (o.commit ?? {}) as Record<string, unknown>;
    return { name: o.name, sha: c.sha, protected: o.protected };
  });
  return { status: "ok", output: { branches: slim, count: slim.length } };
}

async function createBranch(rt: GitHubRuntime, input: Record<string, unknown>): Promise<ToolCallResult> {
  const repo = asStr(input.repo);
  const branch = asStr(input.branch);
  if (!repo || !branch) return invalidInput("github_create_branch requires `repo` and `branch`.");
  const guard = requireBranchInNamespace(rt, branch, "branch");
  if (guard) return guard;

  // Resolve source ref. If from_branch supplied, use it; else fetch repo to
  // learn the default branch (one extra call but avoids guessing 'main' vs 'master').
  let fromBranch = asOptStr(input.from_branch);
  if (!fromBranch) {
    const meta = await ghCall(
      rt,
      "GET",
      `/repos/${encodeURIComponent(rt.org)}/${encodeURIComponent(repo)}`,
    );
    if (!meta.ok) return mapGhError(meta);
    fromBranch = (meta.body as Record<string, unknown>).default_branch as string;
  }

  // Get source ref's sha.
  const ref = await ghCall(
    rt,
    "GET",
    `/repos/${encodeURIComponent(rt.org)}/${encodeURIComponent(repo)}/git/ref/heads/${encodeURIComponent(fromBranch)}`,
  );
  if (!ref.ok) return mapGhError(ref);
  const sha = ((ref.body as Record<string, unknown>).object as Record<string, unknown>)?.sha;
  if (typeof sha !== "string")
    return {
      status: "error",
      output: ref.body,
      errorCode: "github_unexpected_response",
      errorMessage: "github_create_branch: source ref response missing object.sha",
    };

  const create = await ghCall(
    rt,
    "POST",
    `/repos/${encodeURIComponent(rt.org)}/${encodeURIComponent(repo)}/git/refs`,
    { body: { ref: `refs/heads/${branch}`, sha } },
  );
  if (!create.ok) return mapGhError(create);
  const c = create.body as Record<string, unknown>;
  return {
    status: "ok",
    output: { ref: c.ref, sha: ((c.object ?? {}) as Record<string, unknown>).sha, branch, from: fromBranch },
  };
}

async function readFile(rt: GitHubRuntime, input: Record<string, unknown>): Promise<ToolCallResult> {
  const repo = asStr(input.repo);
  const path = asStr(input.path);
  if (!repo || !path) return invalidInput("github_read_file requires `repo` and `path`.");
  const res = await ghCall(
    rt,
    "GET",
    `/repos/${encodeURIComponent(rt.org)}/${encodeURIComponent(repo)}/contents/${encodeURI(path)}`,
    { query: { ref: asOptStr(input.ref) ?? undefined } },
  );
  if (!res.ok) return mapGhError(res);
  const r = res.body as Record<string, unknown>;
  if (Array.isArray(r) || r.type !== "file") {
    return {
      status: "error",
      output: r,
      errorCode: "github_not_a_file",
      errorMessage: `Path '${path}' is not a file (it may be a directory).`,
    };
  }
  const encoding = r.encoding as string | undefined;
  const contentB64 = r.content as string | undefined;
  let content = "";
  if (typeof contentB64 === "string") {
    if (encoding === "base64") {
      content = Buffer.from(contentB64.replace(/\n/g, ""), "base64").toString("utf-8");
    } else {
      content = contentB64;
    }
  }
  return {
    status: "ok",
    output: { path: r.path, sha: r.sha, size: r.size, content },
  };
}

async function commitFiles(rt: GitHubRuntime, input: Record<string, unknown>): Promise<ToolCallResult> {
  const repo = asStr(input.repo);
  const branch = asStr(input.branch);
  const message = asStr(input.message);
  if (!repo || !branch || !message)
    return invalidInput("github_commit_files requires `repo`, `branch`, and `message`.");
  const guard = requireBranchInNamespace(rt, branch, "branch");
  if (guard) return guard;
  if (!Array.isArray(input.files) || input.files.length === 0)
    return invalidInput("github_commit_files requires a non-empty `files` array.");

  // 1. Fetch current branch ref + commit sha + tree sha.
  const refRes = await ghCall(
    rt,
    "GET",
    `/repos/${encodeURIComponent(rt.org)}/${encodeURIComponent(repo)}/git/ref/heads/${encodeURIComponent(branch)}`,
  );
  if (!refRes.ok) return mapGhError(refRes);
  const parentCommitSha = ((refRes.body as Record<string, unknown>).object as Record<string, unknown>)?.sha as string;

  const commitRes = await ghCall(
    rt,
    "GET",
    `/repos/${encodeURIComponent(rt.org)}/${encodeURIComponent(repo)}/git/commits/${parentCommitSha}`,
  );
  if (!commitRes.ok) return mapGhError(commitRes);
  const baseTreeSha = ((commitRes.body as Record<string, unknown>).tree as Record<string, unknown>)?.sha as string;

  // 2. Create blobs for each file.
  const treeEntries: Array<Record<string, unknown>> = [];
  for (const f of input.files as unknown[]) {
    if (!f || typeof f !== "object")
      return invalidInput("github_commit_files: each file must be an object.");
    const file = f as Record<string, unknown>;
    const path = asStr(file.path);
    if (!path) return invalidInput("github_commit_files: file.path is required.");
    const content = typeof file.content === "string" ? file.content : "";
    const encoding = (asOptStr(file.encoding) ?? "utf-8").toLowerCase();
    const blobRes = await ghCall(
      rt,
      "POST",
      `/repos/${encodeURIComponent(rt.org)}/${encodeURIComponent(repo)}/git/blobs`,
      {
        body:
          encoding === "base64"
            ? { content, encoding: "base64" }
            : { content, encoding: "utf-8" },
      },
    );
    if (!blobRes.ok) return mapGhError(blobRes);
    const blobSha = (blobRes.body as Record<string, unknown>).sha as string;
    treeEntries.push({ path, mode: "100644", type: "blob", sha: blobSha });
  }

  // 3. Deletions — represented as tree entries with sha=null (per GitHub API).
  if (Array.isArray(input.deletions)) {
    for (const d of input.deletions as unknown[]) {
      if (typeof d !== "string" || d.length === 0) continue;
      treeEntries.push({ path: d, mode: "100644", type: "blob", sha: null });
    }
  }

  // 4. Create tree.
  const treeRes = await ghCall(
    rt,
    "POST",
    `/repos/${encodeURIComponent(rt.org)}/${encodeURIComponent(repo)}/git/trees`,
    { body: { base_tree: baseTreeSha, tree: treeEntries } },
  );
  if (!treeRes.ok) return mapGhError(treeRes);
  const newTreeSha = (treeRes.body as Record<string, unknown>).sha as string;

  // 5. Create commit.
  const newCommitRes = await ghCall(
    rt,
    "POST",
    `/repos/${encodeURIComponent(rt.org)}/${encodeURIComponent(repo)}/git/commits`,
    {
      body: {
        message,
        tree: newTreeSha,
        parents: [parentCommitSha],
        author: {
          name: "co-os-bot",
          email: "co-os-bot@charlieoscar.com",
          date: new Date().toISOString(),
        },
      },
    },
  );
  if (!newCommitRes.ok) return mapGhError(newCommitRes);
  const newCommit = newCommitRes.body as Record<string, unknown>;
  const newCommitSha = newCommit.sha as string;

  // 6. Update branch ref to the new commit.
  const updateRes = await ghCall(
    rt,
    "PATCH",
    `/repos/${encodeURIComponent(rt.org)}/${encodeURIComponent(repo)}/git/refs/heads/${encodeURIComponent(branch)}`,
    { body: { sha: newCommitSha, force: false } },
  );
  if (!updateRes.ok) return mapGhError(updateRes);

  return {
    status: "ok",
    output: {
      branch,
      commit_sha: newCommitSha,
      commit_url: newCommit.html_url,
      message,
      file_count: (Array.isArray(input.files) ? input.files.length : 0),
      deletion_count: Array.isArray(input.deletions) ? input.deletions.length : 0,
    },
  };
}

async function openPr(rt: GitHubRuntime, input: Record<string, unknown>): Promise<ToolCallResult> {
  const repo = asStr(input.repo);
  const head = asStr(input.head);
  const title = asStr(input.title);
  if (!repo || !head || !title)
    return invalidInput("github_open_pr requires `repo`, `head`, and `title`.");
  const guard = requireBranchInNamespace(rt, head, "head");
  if (guard) return guard;
  let base = asOptStr(input.base);
  if (!base) {
    const meta = await ghCall(rt, "GET", `/repos/${encodeURIComponent(rt.org)}/${encodeURIComponent(repo)}`);
    if (!meta.ok) return mapGhError(meta);
    base = (meta.body as Record<string, unknown>).default_branch as string;
  }
  const res = await ghCall(rt, "POST", `/repos/${encodeURIComponent(rt.org)}/${encodeURIComponent(repo)}/pulls`, {
    body: {
      title,
      head,
      base,
      body: asOptStr(input.body) ?? undefined,
      draft: asOptBool(input.draft) ?? false,
    },
  });
  if (!res.ok) return mapGhError(res);
  const r = res.body as Record<string, unknown>;
  return {
    status: "ok",
    output: {
      number: r.number,
      state: r.state,
      html_url: r.html_url,
      base,
      head,
      title,
      draft: r.draft,
    },
  };
}

async function readPrStatus(rt: GitHubRuntime, input: Record<string, unknown>): Promise<ToolCallResult> {
  const repo = asStr(input.repo);
  const prNumber = asOptInt(input.pr_number);
  if (!repo || prNumber == null)
    return invalidInput("github_read_pr_status requires `repo` and `pr_number`.");
  const res = await ghCall(
    rt,
    "GET",
    `/repos/${encodeURIComponent(rt.org)}/${encodeURIComponent(repo)}/pulls/${prNumber}`,
  );
  if (!res.ok) return mapGhError(res);
  const r = res.body as Record<string, unknown>;
  return {
    status: "ok",
    output: {
      number: r.number,
      state: r.state,
      merged: r.merged,
      draft: r.draft,
      title: r.title,
      html_url: r.html_url,
      base: ((r.base ?? {}) as Record<string, unknown>).ref,
      head: ((r.head ?? {}) as Record<string, unknown>).ref,
      mergeable: r.mergeable,
      mergeable_state: r.mergeable_state,
      updated_at: r.updated_at,
    },
  };
}

async function commentOnPr(rt: GitHubRuntime, input: Record<string, unknown>): Promise<ToolCallResult> {
  const repo = asStr(input.repo);
  const prNumber = asOptInt(input.pr_number);
  const body = asStr(input.body);
  if (!repo || prNumber == null || !body)
    return invalidInput("github_comment_on_pr requires `repo`, `pr_number`, and `body`.");
  const res = await ghCall(
    rt,
    "POST",
    `/repos/${encodeURIComponent(rt.org)}/${encodeURIComponent(repo)}/issues/${prNumber}/comments`,
    { body: { body } },
  );
  if (!res.ok) return mapGhError(res);
  const r = res.body as Record<string, unknown>;
  return {
    status: "ok",
    output: { id: r.id, html_url: r.html_url, created_at: r.created_at },
  };
}

function invalidInput(msg: string): ToolCallResult {
  return {
    status: "error",
    output: null,
    errorCode: "invalid_input",
    errorMessage: msg,
  };
}

// ---------------------------------------------------------------------------
// Top-level dispatcher
// ---------------------------------------------------------------------------

async function dispatch(
  rt: GitHubRuntime,
  name: string,
  input: Record<string, unknown>,
): Promise<ToolCallResult> {
  if ((FORBIDDEN_TOOL_NAMES as readonly string[]).includes(name)) {
    return {
      status: "blocked",
      output: { reason: FORBIDDEN_RATIONALE[name] ?? "forbidden" },
      errorCode: "permission_denied",
      errorMessage:
        FORBIDDEN_RATIONALE[name] ??
        `Tool ${name} is forbidden in v0 substrate.`,
    };
  }
  try {
    switch (name) {
      case "github_list_repos":
        return await listRepos(rt, input);
      case "github_create_repo":
        return await createRepo(rt, input);
      case "github_get_repo":
        return await getRepo(rt, input);
      case "github_list_branches":
        return await listBranches(rt, input);
      case "github_create_branch":
        return await createBranch(rt, input);
      case "github_read_file":
        return await readFile(rt, input);
      case "github_commit_files":
        return await commitFiles(rt, input);
      case "github_open_pr":
        return await openPr(rt, input);
      case "github_read_pr_status":
        return await readPrStatus(rt, input);
      case "github_comment_on_pr":
        return await commentOnPr(rt, input);
      default:
        return {
          status: "error",
          output: null,
          errorCode: "unknown_tool",
          errorMessage: `Unknown GitHub tool: ${name}`,
        };
    }
  } catch (err) {
    return {
      status: "error",
      output: null,
      errorCode: "github_unreachable",
      errorMessage: err instanceof Error ? err.message : String(err),
    };
  }
}

// ---------------------------------------------------------------------------
// Tool builders
// ---------------------------------------------------------------------------

function makeTool(spec: ToolSpec, fetchImpl?: typeof fetch): Tool {
  return {
    spec,
    dispatch: async (call: ToolCallInput) => {
      const r = makeRuntime(fetchImpl);
      if (r.error) return r.error;
      return dispatch(r.rt!, spec.name, call.input);
    },
  };
}

/** Single-tool builder. agent.toolBuilders.push(githubTool('github_open_pr')). */
export function githubTool(toolName: string): ToolBuilder {
  return (_ctx: ToolBuildContext): Tool => {
    const spec = SPECS[toolName];
    if (!spec) throw new Error(`githubTool: unknown GitHub tool '${toolName}'`);
    return makeTool(spec);
  };
}

/** Returns the canonical Grace surface — allowed tools + forbidden mounted-but-blocked. */
export function githubToolBuilders(scope: "grace"): ToolBuilder[] {
  if (scope !== "grace") {
    throw new Error(`githubToolBuilders: unknown scope '${scope}'`);
  }
  return GRACE_GITHUB_TOOL_NAMES.map((n) => githubTool(n));
}

// ---------------------------------------------------------------------------
// Test seam — lets unit tests inject a mock fetch.
// ---------------------------------------------------------------------------

export function githubToolForTest(toolName: string, fetchImpl: typeof fetch): ToolBuilder {
  return (_ctx: ToolBuildContext): Tool => {
    const spec = SPECS[toolName];
    if (!spec) throw new Error(`githubToolForTest: unknown tool '${toolName}'`);
    return makeTool(spec, fetchImpl);
  };
}

export const ALL_GITHUB_TOOL_NAMES: readonly string[] = [...GRACE_GITHUB_TOOL_NAMES];
