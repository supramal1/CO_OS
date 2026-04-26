// Cornerstone tools for Claude Agent runtime.
//
// Ports the 11 agent-facing tool specs and their dispatch behaviour from the
// Paperclip managed-agents adapter (see
// ~/paperclip-eval/paperclip-src/server/src/services/cornerstone-tools.ts and
// /packages/adapters/managed-agents/src/server/cornerstone-tool-specs.ts).
//
// Locked behaviours that must NOT be reinterpreted:
// - Writes always force the resolved write namespace (task → AI_OPS fallback).
//   The agent cannot override via tool input — closes prompt-injection on
//   cross-namespace writes.
// - Reads accept agent-supplied namespace as an escape hatch ONLY when the
//   task has no targetWorkspace pinned.
// - steward_apply returns { status: "blocked", errorCode: "approval_queue_not_available" }
//   for v0 — the approval-queue UI hasn't shipped.

import {
  AI_OPS_WORKSPACE,
  type Tool,
  type ToolBuildContext,
  type ToolBuilder,
  type ToolCallInput,
  type ToolCallResult,
  type ToolSpec,
} from "../types.js";

// ---------------------------------------------------------------------------
// Tool name lists — used to gate write-vs-read and blocked tools.
// ---------------------------------------------------------------------------

const READ_TOOL_NAMES = [
  "get_context",
  "search",
  "list_facts",
  "recall",
  "steward_inspect",
  "steward_advise",
  "steward_status",
] as const;

const WRITE_TOOL_NAMES = [
  "add_fact",
  "save_conversation",
  "steward_preview",
  "steward_apply",
] as const;

const BLOCKED_TOOL_NAMES = ["steward_apply"] as const;

// ---------------------------------------------------------------------------
// Steward sub-operation routing tables (mirrors paperclip src).
// ---------------------------------------------------------------------------

const STEWARD_INSPECT_OPERATIONS: Readonly<Record<string, string>> = {
  duplicates: "/ops/steward/inspect/duplicates",
  contradictions: "/ops/steward/inspect/contradictions",
  stale: "/ops/steward/inspect/stale",
  expired: "/ops/steward/inspect/expired",
  orphans: "/ops/steward/inspect/orphans",
  "key-taxonomy": "/ops/steward/inspect/key-taxonomy",
  "missing-dates": "/ops/steward/inspect/missing-dates",
  "stale-embeddings": "/ops/steward/inspect/stale-embeddings",
  "cross-workspace-duplicates": "/ops/steward/inspect/cross-workspace-duplicates",
  "retrieval-interference": "/ops/steward/inspect/retrieval-interference",
  "composite-health": "/ops/steward/inspect/composite-health",
  "fact-quality": "/ops/steward/inspect/fact-quality",
};

const STEWARD_ADVISE_OPERATIONS: Readonly<Record<string, string>> = {
  merge: "/ops/steward/advise/merge",
  consolidate: "/ops/steward/advise/consolidate",
  "stale-review": "/ops/steward/advise/stale-review",
  "key-taxonomy": "/ops/steward/advise/key-taxonomy",
  contradictions: "/ops/steward/advise/contradictions",
};

const STEWARD_PREVIEW_OPERATIONS: Readonly<Record<string, string>> = {
  "merge-duplicates": "/ops/steward/mutate/merge-duplicates/preview",
  "merge-notes": "/ops/steward/mutate/merge-notes/preview",
  "archive-stale": "/ops/steward/mutate/archive-stale/preview",
  "delete-by-filter": "/ops/steward/mutate/delete-by-filter/preview",
  "consolidate-facts": "/ops/steward/mutate/consolidate-facts/preview",
  "reembed-stale": "/ops/steward/mutate/reembed-stale/preview",
  "rename-keys": "/ops/steward/mutate/rename-keys/preview",
};

// ---------------------------------------------------------------------------
// Tool spec helpers
// ---------------------------------------------------------------------------

function readNamespaceField(): { type: "string"; description: string } {
  return {
    type: "string",
    description:
      "Defaults to your task's target workspace; pass namespace explicitly to override (only honoured when the task has no target workspace pinned).",
  };
}

function buildSpecs(): Record<string, ToolSpec> {
  return {
    get_context: {
      name: "get_context",
      description:
        "Retrieve structured context from Cornerstone memory for a natural-language query. Returns a composed context bundle (facts, notes, summaries). Use this before making architecture or sprint decisions to ground your reasoning in prior work.",
      input_schema: {
        type: "object",
        properties: {
          query: { type: "string", description: "Natural-language query." },
          namespace: readNamespaceField(),
          detail_level: {
            type: "string",
            description: "minimal | standard | comprehensive. Default: standard.",
          },
          max_tokens: { type: "integer", description: "Soft upper bound on returned tokens. Default 2000." },
        },
        required: ["query"],
      },
    },
    search: {
      name: "search",
      description:
        "Lighter-weight lookup than get_context — quick existence check or surface-level answer. Returns a shorter bundle.",
      input_schema: {
        type: "object",
        properties: {
          query: { type: "string", description: "Natural-language query." },
          namespace: readNamespaceField(),
          detail_level: { type: "string", description: "minimal | standard | comprehensive. Default: minimal." },
          max_tokens: { type: "integer", description: "Soft upper bound. Default 600." },
        },
        required: ["query"],
      },
    },
    list_facts: {
      name: "list_facts",
      description:
        "List facts by key prefix or category. Returns raw fact rows (key, value, confidence, updated_at). Use for audits, duplicate hunts, or inspecting a known key family.",
      input_schema: {
        type: "object",
        properties: {
          namespace: readNamespaceField(),
          key_prefix: { type: "string", description: "Filter facts whose key starts with this prefix." },
          category: { type: "string", description: "Filter facts by category." },
          limit: { type: "integer", description: "Maximum facts to return (1-500)." },
        },
        required: [],
      },
    },
    recall: {
      name: "recall",
      description:
        "Higher-detail recall for a specific query. Same backend as get_context but with detail_level=comprehensive and larger token budget.",
      input_schema: {
        type: "object",
        properties: {
          query: { type: "string", description: "Natural-language query." },
          namespace: readNamespaceField(),
          detail_level: { type: "string", description: "minimal | standard | comprehensive. Default: comprehensive." },
          max_tokens: { type: "integer", description: "Soft upper bound. Default 4000." },
        },
        required: ["query"],
      },
    },
    add_fact: {
      name: "add_fact",
      description:
        "Record a discrete, stable, referenceable fact to Cornerstone. Always written to your task's target workspace (or the AI_OPS fallback if the task has no target workspace pinned); namespace cannot be overridden via tool input. Facts must be atomic, dated, and under ~200 tokens.",
      input_schema: {
        type: "object",
        properties: {
          key: { type: "string", description: "Specific, searchable key. Avoid 'update' or 'note'." },
          value: { type: "string", description: "Fact body. Include dates ('Deployed 2026-04-20')." },
          category: { type: "string", description: "Optional category. Default 'general'." },
          confidence: { type: "number", description: "Confidence 0.0-1.0. Default 0.9." },
        },
        required: ["key", "value"],
      },
    },
    save_conversation: {
      name: "save_conversation",
      description:
        "Persist a business-relevant exchange (decision, debugging session, planning) to Cornerstone. Always written to your task's target workspace (or the AI_OPS fallback); namespace cannot be overridden via tool input.",
      input_schema: {
        type: "object",
        properties: {
          topic: { type: "string", description: "Short descriptive topic." },
          messages: {
            type: "array",
            description: "Ordered array of { role: 'user'|'assistant', content: string }.",
          },
          source: { type: "string", description: "Optional source tag." },
        },
        required: ["topic", "messages"],
      },
    },
    steward_inspect: {
      name: "steward_inspect",
      description:
        "Run a read-only Cornerstone steward inspection. Surfaces memory-health issues (duplicates, contradictions, stale rows, etc.). Non-destructive.",
      input_schema: {
        type: "object",
        properties: {
          operation: {
            type: "string",
            description: `Which inspection. One of: ${Object.keys(STEWARD_INSPECT_OPERATIONS).join(", ")}.`,
          },
          namespace: readNamespaceField(),
        },
        required: ["operation"],
      },
    },
    steward_advise: {
      name: "steward_advise",
      description:
        "Request a steward recommendation (merge plan, consolidation plan, taxonomy suggestion). Read-only.",
      input_schema: {
        type: "object",
        properties: {
          operation: {
            type: "string",
            description: `Which advice. One of: ${Object.keys(STEWARD_ADVISE_OPERATIONS).join(", ")}.`,
          },
          namespace: readNamespaceField(),
          items: { type: "array", description: "Items from a prior steward_inspect (when applicable)." },
          item_type: { type: "string", description: "Optional: 'fact' or 'note'." },
          facts: { type: "array", description: "Required for operation=consolidate." },
          inconsistencies: { type: "array", description: "Required for operation=key-taxonomy." },
          pairs: { type: "array", description: "Required for operation=contradictions." },
        },
        required: ["operation"],
      },
    },
    steward_preview: {
      name: "steward_preview",
      description:
        "Dry-run a mutating steward operation. Returns the exact changes that would be applied by steward_apply, without touching memory. Always run against the task's target workspace.",
      input_schema: {
        type: "object",
        properties: {
          operation: {
            type: "string",
            description: `Which mutation to preview. One of: ${Object.keys(STEWARD_PREVIEW_OPERATIONS).join(", ")}.`,
          },
          similarity_threshold: { type: "number", description: "merge-duplicates / merge-notes (default 0.85)." },
          limit: { type: "integer", description: "Max candidates scanned." },
          days_threshold: { type: "integer", description: "archive-stale: rows untouched for N days." },
          source_type: { type: "string", description: "delete-by-filter: 'fact' or 'note'." },
          item_ids: { type: "array", description: "delete-by-filter: ids to delete." },
          keys: { type: "array", description: "delete-by-filter: fact keys to delete." },
          confidence_below: { type: "number", description: "delete-by-filter: confidence threshold." },
          created_before: { type: "string", description: "delete-by-filter: ISO date." },
          content_filter: { type: "string", description: "delete-by-filter: substring match." },
          tags: { type: "array", description: "delete-by-filter: tag match." },
          fact_ids: { type: "array", description: "consolidate-facts: ids to merge." },
          mappings: { type: "array", description: "rename-keys: [{from, to}]." },
        },
        required: ["operation"],
      },
    },
    steward_apply: {
      name: "steward_apply",
      description:
        "Apply a mutating steward operation. Currently BLOCKED in v0 — every call returns 'pending_approval'. Use steward_preview instead and surface the audit as a recommendation.",
      input_schema: {
        type: "object",
        properties: {
          operation: { type: "string", description: "Blocked in v0; see steward_preview." },
        },
        required: ["operation"],
      },
    },
    steward_status: {
      name: "steward_status",
      description:
        "Poll the status of a previously-queued steward maintenance job by job_id.",
      input_schema: {
        type: "object",
        properties: {
          job_id: { type: "string", description: "Maintenance job id." },
        },
        required: ["job_id"],
      },
    },
  };
}

// ---------------------------------------------------------------------------
// Dispatcher factory — closes over the per-invocation context (task
// targetWorkspace, agent default workspace, API key, base URL, fetch impl).
// ---------------------------------------------------------------------------

interface CornerstoneRuntime {
  readonly fetchImpl: typeof fetch;
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly writeNamespace: string;
  readonly taskWorkspace: string | null;
}

interface ApiOk {
  readonly ok: true;
  readonly status: number;
  readonly body: unknown;
}

interface ApiErr {
  readonly ok: false;
  readonly status: number;
  readonly body: unknown;
}

async function callApi(
  rt: CornerstoneRuntime,
  method: "GET" | "POST",
  path: string,
  options: { body?: Record<string, unknown>; query?: Record<string, string> } = {},
): Promise<ApiOk | ApiErr> {
  const url = new URL(`${rt.baseUrl.replace(/\/+$/, "")}${path}`);
  if (options.query) {
    for (const [k, v] of Object.entries(options.query)) {
      if (v !== undefined && v !== "") url.searchParams.set(k, v);
    }
  }
  const res = await rt.fetchImpl(url.toString(), {
    method,
    headers: {
      "X-API-Key": rt.apiKey,
      "content-type": "application/json",
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
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

function mapApiError(
  res: ApiErr,
  resolvedNamespace: string,
  taskWorkspace: string | null,
): ToolCallResult {
  if (isNamespaceGrantFailure(res.status, res.body)) {
    return {
      status: "error",
      output: { status: res.status, body: res.body },
      errorCode: "target_workspace_grant_missing",
      errorMessage:
        `Cornerstone principal has no grant for namespace "${resolvedNamespace}". ` +
        (taskWorkspace
          ? `This task's targetWorkspace is "${taskWorkspace}". Request a grant or change the task's targetWorkspace.`
          : `No targetWorkspace pinned; falling back to AI_OPS_WORKSPACE ("${AI_OPS_WORKSPACE}").`),
    };
  }
  return {
    status: "error",
    output: { status: res.status, body: res.body },
    errorCode: "cornerstone_api_error",
    errorMessage: apiErrorMessage(res.body),
  };
}

function isNamespaceGrantFailure(status: number, body: unknown): boolean {
  if (status !== 403) return false;
  const detail =
    body && typeof body === "object"
      ? ((body as Record<string, unknown>).detail ??
          (body as Record<string, unknown>).error ??
          (body as Record<string, unknown>).message)
      : typeof body === "string"
        ? body
        : null;
  if (typeof detail !== "string") return false;
  const lower = detail.toLowerCase();
  return (
    lower.includes("namespace_not_granted") ||
    lower.includes("namespace is required") ||
    lower.includes("not granted")
  );
}

function apiErrorMessage(body: unknown): string {
  if (body && typeof body === "object") {
    const r = body as Record<string, unknown>;
    const detail = r.detail ?? r.error ?? r.message;
    if (typeof detail === "string") return detail;
  }
  if (typeof body === "string" && body.length > 0) return body;
  return "Cornerstone API error";
}

// Input parsing
function asStr(v: unknown): string | null {
  return typeof v === "string" && v.trim().length > 0 ? v : null;
}
function asOptStr(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}
function asOptInt(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? Math.trunc(v) : null;
}

// ---------------------------------------------------------------------------
// Per-tool dispatchers
// ---------------------------------------------------------------------------

async function dispatch(
  rt: CornerstoneRuntime,
  name: string,
  input: Record<string, unknown>,
): Promise<ToolCallResult> {
  if (BLOCKED_TOOL_NAMES.includes(name as (typeof BLOCKED_TOOL_NAMES)[number])) {
    return {
      status: "blocked",
      output: {
        status: "pending_approval",
        message: `Destructive Cornerstone tool ${name} is gated pending the approval-queue UI. Use steward_preview and surface the audit as a recommendation.`,
      },
      errorCode: "approval_queue_not_available",
      errorMessage: `Tool ${name} is blocked in v0 substrate.`,
    };
  }

  const isWrite = (WRITE_TOOL_NAMES as readonly string[]).includes(name);
  const agentSuppliedNs = asOptStr(input.namespace);

  // Resolution rules (matches paperclip cornerstone-tools.ts):
  //   Writes:  taskWorkspace ?? AI_OPS_WORKSPACE  (agent IGNORED)
  //   Reads:   taskWorkspace ?? agentSupplied ?? AI_OPS_WORKSPACE
  const resolvedNs = isWrite
    ? rt.writeNamespace
    : (rt.taskWorkspace ?? agentSuppliedNs ?? rt.writeNamespace);

  try {
    switch (name) {
      case "get_context":
        return await runContext(rt, input, resolvedNs, "standard", 2000);
      case "search":
        return await runContext(rt, input, resolvedNs, "minimal", 600);
      case "recall":
        return await runContext(rt, input, resolvedNs, "comprehensive", 4000);
      case "list_facts":
        return await runListFacts(rt, input, resolvedNs);
      case "add_fact":
        return await runAddFact(rt, input, resolvedNs);
      case "save_conversation":
        return await runSaveConversation(rt, input, resolvedNs);
      case "steward_inspect":
        return await runStewardMeta(
          rt,
          input,
          resolvedNs,
          "steward_inspect",
          STEWARD_INSPECT_OPERATIONS,
          "GET",
        );
      case "steward_advise":
        return await runStewardMeta(
          rt,
          input,
          resolvedNs,
          "steward_advise",
          STEWARD_ADVISE_OPERATIONS,
          "POST",
        );
      case "steward_preview":
        return await runStewardPreview(rt, input);
      case "steward_status":
        return await runStewardStatus(rt, input);
      default:
        return {
          status: "error",
          output: null,
          errorCode: "unknown_tool",
          errorMessage: `Unknown Cornerstone tool: ${name}`,
        };
    }
  } catch (err) {
    return {
      status: "error",
      output: null,
      errorCode: "cornerstone_api_unreachable",
      errorMessage: err instanceof Error ? err.message : String(err),
    };
  }
}

async function runContext(
  rt: CornerstoneRuntime,
  input: Record<string, unknown>,
  ns: string,
  defaultDetail: string,
  defaultMaxTokens: number,
): Promise<ToolCallResult> {
  const query = asStr(input.query);
  if (!query)
    return { status: "error", output: null, errorCode: "invalid_input", errorMessage: "query is required" };
  const body: Record<string, unknown> = {
    query,
    namespace: ns,
    detail_level: asOptStr(input.detail_level) ?? defaultDetail,
    max_tokens: asOptInt(input.max_tokens) ?? defaultMaxTokens,
  };
  const res = await callApi(rt, "POST", "/context", { body });
  if (!res.ok) return mapApiError(res, ns, rt.taskWorkspace);
  return { status: "ok", output: res.body };
}

async function runListFacts(
  rt: CornerstoneRuntime,
  input: Record<string, unknown>,
  ns: string,
): Promise<ToolCallResult> {
  const query: Record<string, string> = { namespace: ns };
  const kp = asOptStr(input.key_prefix);
  if (kp) query.key_prefix = kp;
  const cat = asOptStr(input.category);
  if (cat) query.category = cat;
  const limit = asOptInt(input.limit);
  if (limit !== null) query.limit = String(Math.max(1, Math.min(limit, 500)));
  const res = await callApi(rt, "GET", "/memory/facts", { query });
  if (!res.ok) return mapApiError(res, ns, rt.taskWorkspace);
  return { status: "ok", output: res.body };
}

async function runAddFact(
  rt: CornerstoneRuntime,
  input: Record<string, unknown>,
  writeNs: string,
): Promise<ToolCallResult> {
  const key = asStr(input.key);
  const value = asStr(input.value);
  if (!key)
    return { status: "error", output: null, errorCode: "invalid_input", errorMessage: "key required" };
  if (!value)
    return { status: "error", output: null, errorCode: "invalid_input", errorMessage: "value required" };
  const body: Record<string, unknown> = {
    key,
    value,
    namespace: writeNs,
    category: asOptStr(input.category) ?? "general",
    confidence: typeof input.confidence === "number" ? input.confidence : 0.9,
  };
  const res = await callApi(rt, "POST", "/memory/fact", { body });
  if (!res.ok) return mapApiError(res, writeNs, rt.taskWorkspace);
  return { status: "ok", output: res.body };
}

async function runSaveConversation(
  rt: CornerstoneRuntime,
  input: Record<string, unknown>,
  writeNs: string,
): Promise<ToolCallResult> {
  const topic = asStr(input.topic);
  if (!topic)
    return { status: "error", output: null, errorCode: "invalid_input", errorMessage: "topic required" };
  const messages = Array.isArray(input.messages) ? (input.messages as unknown[]) : null;
  if (!messages || messages.length === 0)
    return {
      status: "error",
      output: null,
      errorCode: "invalid_input",
      errorMessage: "messages array required",
    };
  const body: Record<string, unknown> = { topic, messages, namespace: writeNs };
  const source = asOptStr(input.source);
  if (source) body.source = source;
  // Cornerstone's /ingest endpoint takes flat user_message/assistant_response;
  // /ingest/conversation is the multi-turn entrypoint that flattens messages
  // server-side and writes the explicit topic onto the session row.
  const res = await callApi(rt, "POST", "/ingest/conversation", { body });
  if (!res.ok) return mapApiError(res, writeNs, rt.taskWorkspace);
  return { status: "ok", output: res.body };
}

async function runStewardMeta(
  rt: CornerstoneRuntime,
  input: Record<string, unknown>,
  ns: string,
  toolName: "steward_inspect" | "steward_advise",
  table: Readonly<Record<string, string>>,
  method: "GET" | "POST",
): Promise<ToolCallResult> {
  const operation = asStr(input.operation);
  if (!operation)
    return {
      status: "error",
      output: null,
      errorCode: "invalid_input",
      errorMessage: `${toolName} requires operation`,
    };
  const path = table[operation];
  if (!path)
    return {
      status: "error",
      output: null,
      errorCode: "unsupported_operation",
      errorMessage: `${toolName} does not support ${operation}. Supported: ${Object.keys(table).join(", ")}`,
    };
  const res =
    method === "GET"
      ? await callApi(rt, "GET", path, { query: { namespace: ns } })
      : await callApi(rt, "POST", path, { body: { ...input, namespace: ns } });
  if (!res.ok) return mapApiError(res, ns, rt.taskWorkspace);
  return { status: "ok", output: res.body };
}

async function runStewardPreview(
  rt: CornerstoneRuntime,
  input: Record<string, unknown>,
): Promise<ToolCallResult> {
  const operation = asStr(input.operation);
  if (!operation)
    return {
      status: "error",
      output: null,
      errorCode: "invalid_input",
      errorMessage: "steward_preview requires operation",
    };
  const path = STEWARD_PREVIEW_OPERATIONS[operation];
  if (!path)
    return {
      status: "error",
      output: null,
      errorCode: "unsupported_operation",
      errorMessage: `steward_preview does not support ${operation}. Supported: ${Object.keys(STEWARD_PREVIEW_OPERATIONS).join(", ")}`,
    };
  const body: Record<string, unknown> = { ...input, namespace: rt.writeNamespace };
  const res = await callApi(rt, "POST", path, { body });
  if (!res.ok) return mapApiError(res, rt.writeNamespace, rt.taskWorkspace);
  return { status: "ok", output: res.body };
}

async function runStewardStatus(
  rt: CornerstoneRuntime,
  input: Record<string, unknown>,
): Promise<ToolCallResult> {
  const jobId = asStr(input.job_id);
  if (!jobId)
    return {
      status: "error",
      output: null,
      errorCode: "invalid_input",
      errorMessage: "steward_status requires job_id",
    };
  const res = await callApi(rt, "GET", `/ops/maintenance/jobs/${encodeURIComponent(jobId)}`);
  if (!res.ok) {
    return {
      status: "error",
      output: { status: res.status, body: res.body },
      errorCode: "cornerstone_api_error",
      errorMessage: apiErrorMessage(res.body),
    };
  }
  return { status: "ok", output: res.body };
}

// ---------------------------------------------------------------------------
// Builder helpers — choose which subset of tools to mount per agent.
// ---------------------------------------------------------------------------

const SPECS = buildSpecs();

function makeRuntime(ctx: ToolBuildContext, fetchImpl?: typeof fetch): CornerstoneRuntime {
  const taskWorkspace = ctx.task.targetWorkspace ?? null;
  const writeNamespace = taskWorkspace ?? ctx.agent.defaultWorkspace ?? AI_OPS_WORKSPACE;
  return {
    fetchImpl: fetchImpl ?? fetch,
    baseUrl: ctx.cornerstoneApiBaseUrl,
    apiKey: ctx.cornerstoneApiKey,
    writeNamespace,
    taskWorkspace,
  };
}

function makeTool(spec: ToolSpec, rt: CornerstoneRuntime): Tool {
  return {
    spec,
    dispatch: async (call: ToolCallInput) => dispatch(rt, spec.name, call.input),
  };
}

/** Read-only Cornerstone tool builders (get_context, search, list_facts, recall). */
export const buildCornerstoneReadTools: ToolBuilder[] = cornerstoneToolBuilders("read-only");

/** Single-tool Cornerstone builder. agent.toolBuilders.push(cornerstoneTool('get_context')). */
export function cornerstoneTool(toolName: string): ToolBuilder {
  return (ctx: ToolBuildContext): Tool => {
    const spec = SPECS[toolName];
    if (!spec) {
      throw new Error(`cornerstoneTool: unknown Cornerstone tool '${toolName}'`);
    }
    return makeTool(spec, makeRuntime(ctx));
  };
}

/** Returns a list of ToolBuilders, one per Cornerstone tool the agent should mount. */
export function cornerstoneToolBuilders(
  scope: "read-only" | "read-write" | "all" | "donald",
): ToolBuilder[] {
  let names: readonly string[];
  switch (scope) {
    case "read-only":
      names = READ_TOOL_NAMES;
      break;
    case "read-write":
      // No steward — Donald only.
      names = [
        "get_context",
        "search",
        "list_facts",
        "recall",
        "add_fact",
        "save_conversation",
      ];
      break;
    case "donald":
      // Donald owns hygiene — gets the steward family too. steward_apply is
      // mounted but always blocked in v0 so the agent learns to call it and
      // see the pending_approval, rather than not knowing it exists.
      names = [
        "get_context",
        "search",
        "list_facts",
        "recall",
        "add_fact",
        "save_conversation",
        "steward_inspect",
        "steward_advise",
        "steward_preview",
        "steward_apply",
        "steward_status",
      ];
      break;
    case "all":
      names = [...READ_TOOL_NAMES, ...WRITE_TOOL_NAMES];
      break;
  }
  return names.map((n) => cornerstoneTool(n));
}

/** Convenience aliases the index re-exports. */
export const buildAllCornerstoneTools = cornerstoneToolBuilders("all");
export const buildCornerstoneWriteTools = cornerstoneToolBuilders("read-write");

// ---------------------------------------------------------------------------
// Test-only seam — lets unit tests inject a mock fetch implementation.
// ---------------------------------------------------------------------------

export function cornerstoneToolForTest(
  toolName: string,
  fetchImpl: typeof fetch,
): ToolBuilder {
  return (ctx: ToolBuildContext): Tool => {
    const spec = SPECS[toolName];
    if (!spec) throw new Error(`cornerstoneToolForTest: unknown tool '${toolName}'`);
    return makeTool(spec, makeRuntime(ctx, fetchImpl));
  };
}

export const ALL_CORNERSTONE_TOOL_NAMES: readonly string[] = [
  ...READ_TOOL_NAMES,
  ...WRITE_TOOL_NAMES,
];
