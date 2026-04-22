import "server-only";
import type {
  ScopeType,
  SkillSummary,
  SkillDetail,
} from "@/lib/cookbook-types";

export type { ScopeType, SkillSummary, SkillDetail };

const COOKBOOK_MCP_URL =
  process.env.COOKBOOK_MCP_URL ?? "https://co-cookbook-mcp-lymgtgeena-nw.a.run.app";

export type CreateSkillInput = {
  name: string;
  description: string;
  scope_type: ScopeType;
  content: string;
  scope_id?: string | null;
  owner?: string | null;
  version?: string;
  tags?: string[] | null;
};

export type UpdateSkillInput = {
  description?: string | null;
  scope_type?: ScopeType | null;
  scope_id?: string | null;
  content?: string | null;
  owner?: string | null;
  version?: string | null;
  tags?: string[] | null;
};

export type ExportedSkill = {
  path: string;
  frontmatter: Record<string, string | string[]>;
  content: string;
};

export type ExportPayload = {
  exported_at: string;
  count: number;
  skills: ExportedSkill[];
};

export class CookbookMcpError extends Error {
  readonly status: number;
  readonly code?: number;
  constructor(message: string, status: number, code?: number) {
    super(message);
    this.name = "CookbookMcpError";
    this.status = status;
    this.code = code;
  }
}

type McpToolResult = {
  content?: { type: string; text?: string }[];
  structuredContent?: { result?: string };
  isError?: boolean;
};

type McpResponse = {
  jsonrpc: "2.0";
  id: number | string;
  result?: McpToolResult;
  error?: { code: number; message: string; data?: unknown };
};

/**
 * Parse an SSE stream body and return the first `event: message` data payload.
 * The cookbook MCP runs stateless_http=True and returns one framed message
 * per JSON-RPC request.
 */
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

      // Drain any complete `\n\n`-delimited frames.
      while (true) {
        const sep = buffer.indexOf("\n\n");
        if (sep === -1) break;
        const frame = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);
        const hit = tryFrame(frame);
        if (hit) return hit;
      }

      if (done) {
        // Flush remaining buffer (some servers omit trailing \n\n).
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

  throw new CookbookMcpError("MCP returned empty stream", 502);
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
    cache: "no-store",
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "(no body)");
    throw new CookbookMcpError(
      `Cookbook MCP ${res.status}: ${text.slice(0, 200)}`,
      res.status,
    );
  }
  if (!res.body) {
    throw new CookbookMcpError("Cookbook MCP returned no body", 502);
  }

  const contentType = res.headers.get("content-type") ?? "";
  let payload: McpResponse;
  if (contentType.includes("text/event-stream")) {
    payload = await parseSseJsonRpc(res.body);
  } else {
    payload = (await res.json()) as McpResponse;
  }

  if (payload.error) {
    throw new CookbookMcpError(
      payload.error.message || "MCP error",
      502,
      payload.error.code,
    );
  }

  const result = payload.result;
  if (!result) {
    throw new CookbookMcpError("MCP returned no result", 502);
  }

  const raw =
    result.structuredContent?.result ??
    result.content?.find((c) => c.type === "text")?.text ??
    null;

  if (raw == null) {
    throw new CookbookMcpError("MCP returned empty content", 502);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new CookbookMcpError("MCP returned non-JSON payload", 502);
  }

  // Tools return admin_denied or namespace errors as `{error: "..."}`
  if (
    parsed &&
    typeof parsed === "object" &&
    "error" in (parsed as Record<string, unknown>)
  ) {
    const err = parsed as { error: string; detail?: string };
    const denied = err.error === "admin_denied" || err.error === "forbidden";
    throw new CookbookMcpError(
      err.detail || err.error,
      denied ? 403 : 502,
    );
  }

  return parsed as T;
}

export async function listSkills(apiKey: string): Promise<SkillSummary[]> {
  return callMcpTool<SkillSummary[]>(apiKey, "list_skills");
}

export async function getSkill(apiKey: string, name: string): Promise<SkillDetail> {
  return callMcpTool<SkillDetail>(apiKey, "get_skill", { name });
}

export async function createSkill(
  apiKey: string,
  input: CreateSkillInput,
): Promise<SkillDetail> {
  return callMcpTool<SkillDetail>(apiKey, "create_skill", input as Record<string, unknown>);
}

export async function updateSkill(
  apiKey: string,
  name: string,
  fields: UpdateSkillInput,
): Promise<SkillDetail> {
  return callMcpTool<SkillDetail>(apiKey, "update_skill", {
    name,
    ...fields,
  });
}

export async function deleteSkill(
  apiKey: string,
  name: string,
): Promise<{ deleted: boolean; name: string }> {
  return callMcpTool<{ deleted: boolean; name: string }>(apiKey, "delete_skill", { name });
}

export async function exportSkills(apiKey: string): Promise<ExportPayload> {
  return callMcpTool<ExportPayload>(apiKey, "export_skills");
}

export async function testSkill(
  apiKey: string,
  name: string,
  prompt: string,
): Promise<{ response: string }> {
  return callMcpTool<{ response: string }>(apiKey, "test_skill", { name, prompt });
}
