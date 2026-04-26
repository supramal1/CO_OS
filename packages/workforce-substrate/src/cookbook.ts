// Cookbook MCP client used to fetch agent system prompts at roster build
// time. Mirrors the contract in ~/co-os/lib/cookbook-client.ts but is
// dependency-free (no "server-only", no Next types) so the substrate can
// run from a CLI without pulling Next at all.
//
// We only need read paths for the substrate — `get_skill(name)` returns the
// SkillDetail which carries the `content` field. That `content` is the
// agent's system prompt verbatim. v0 does not author or modify skills from
// the substrate.

const COOKBOOK_MCP_URL =
  process.env.COOKBOOK_MCP_URL ?? "https://co-cookbook-mcp-lymgtgeena-nw.a.run.app";

export class CookbookError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "CookbookError";
    this.status = status;
  }
}

interface McpToolResult {
  content?: { type: string; text?: string }[];
  structuredContent?: { result?: string };
  isError?: boolean;
}

interface McpResponse {
  jsonrpc: "2.0";
  id: number | string;
  result?: McpToolResult;
  error?: { code: number; message: string; data?: unknown };
}

async function parseSseJsonRpc(body: ReadableStream<Uint8Array>): Promise<McpResponse> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const tryFrame = (frame: string): McpResponse | null => {
    for (const line of frame.split("\n")) {
      if (line.startsWith("data:")) {
        return JSON.parse(line.slice(5).trim()) as McpResponse;
      }
    }
    return null;
  };
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (value) buffer += decoder.decode(value, { stream: !done });
      while (true) {
        const sep = buffer.indexOf("\n\n");
        if (sep === -1) break;
        const frame = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);
        const hit = tryFrame(frame);
        if (hit) return hit;
      }
      if (done) {
        const trimmed = buffer.trim();
        if (trimmed) {
          const hit = tryFrame(trimmed);
          if (hit) return hit;
        }
        break;
      }
    }
  } finally {
    reader.releaseLock();
  }
  throw new CookbookError("Cookbook MCP returned empty stream", 502);
}

let requestCounter = 0;

async function callMcpTool<T>(
  apiKey: string,
  name: string,
  args: Record<string, unknown> = {},
): Promise<T> {
  const id = ++requestCounter;
  const res = await fetch(COOKBOOK_MCP_URL + "/", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id,
      method: "tools/call",
      params: { name, arguments: args },
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "(no body)");
    throw new CookbookError(
      `Cookbook MCP ${res.status}: ${text.slice(0, 200)}`,
      res.status,
    );
  }
  if (!res.body) throw new CookbookError("Cookbook MCP returned no body", 502);
  const contentType = res.headers.get("content-type") ?? "";
  const payload: McpResponse = contentType.includes("text/event-stream")
    ? await parseSseJsonRpc(res.body)
    : ((await res.json()) as McpResponse);
  if (payload.error) {
    throw new CookbookError(payload.error.message || "MCP error", 502);
  }
  const result = payload.result;
  if (!result) throw new CookbookError("MCP returned no result", 502);
  const raw =
    result.structuredContent?.result ??
    result.content?.find((c) => c.type === "text")?.text ??
    null;
  if (raw == null) throw new CookbookError("MCP returned empty content", 502);
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new CookbookError("MCP returned non-JSON payload", 502);
  }
  if (parsed && typeof parsed === "object" && "error" in (parsed as Record<string, unknown>)) {
    const err = parsed as { error: string; detail?: string };
    throw new CookbookError(err.detail || err.error, 502);
  }
  return parsed as T;
}

export interface SkillDetail {
  name: string;
  description: string;
  content: string;
  scope_type?: string;
  scope_id?: string | null;
  owner?: string | null;
  version?: string | null;
  tags?: string[] | null;
}

/**
 * Fetch a skill's content from Cookbook MCP. Used by the runtime to load
 * agent system prompts at roster build / first-invocation time.
 *
 * Auth: Cookbook MCP authenticates via Cornerstone-issued API keys (csk_*).
 * Resolution order: COOKBOOK_API_KEY (explicit override) → CORNERSTONE_API_KEY
 * (canonical csk_*) → MEMORY_API_KEY (legacy fallback). MEMORY_API_KEY is the
 * Cornerstone REST API key — same backend, but the prefix differs across
 * deployments, hence the multi-source resolution.
 *
 * The runtime caller's principal must have grants for the skill's scope
 * (e.g. team:ai-ops for the v0 agent prompts) — Cookbook returns
 * `skill_out_of_scope` rather than 401 in that case.
 *
 * v0 fetches on every invocation. Caching is a v0.1 concern; on Cloud Run
 * we'll cache per-process.
 */
export async function loadSystemPrompt(skillName: string): Promise<string> {
  const apiKey =
    process.env.COOKBOOK_API_KEY ??
    process.env.CORNERSTONE_API_KEY ??
    process.env.MEMORY_API_KEY ??
    "";
  if (!apiKey) {
    throw new CookbookError(
      "Cookbook system-prompt load requires COOKBOOK_API_KEY, CORNERSTONE_API_KEY, or MEMORY_API_KEY env var.",
      401,
    );
  }
  const detail = await callMcpTool<SkillDetail>(apiKey, "get_skill", { name: skillName });
  if (!detail || typeof detail.content !== "string" || detail.content.length === 0) {
    throw new CookbookError(
      `Cookbook skill '${skillName}' resolved but has no content body.`,
      502,
    );
  }
  return detail.content;
}
