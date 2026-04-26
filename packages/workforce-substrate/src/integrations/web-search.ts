// Anthropic server-side web_search tool builder.
//
// Anthropic provides web_search as a server-side managed tool — the model
// emits a tool_use, the API runs the search server-side, and the model gets
// the results without our runtime ever dispatching anything. We still need
// to expose the tool through the same ToolBuilder shape so the runtime can
// register it in the per-invocation tools array; the runtime detects
// spec.name === "web_search" and converts it to the server-side
// web_search_20250305 spec at request build time.
//
// The dispatch implementation here is a no-op safety net — Anthropic does
// not call back into our process for server-side tools, so this code path
// only fires if the runtime mis-routes a tool_use. Returning an explicit
// error makes that fault loud rather than silent.

import type {
  Tool,
  ToolBuilder,
  ToolCallInput,
  ToolCallResult,
  ToolSpec,
} from "../types.js";

const SPEC: ToolSpec = {
  name: "web_search",
  description:
    "Search the public web for current information. Server-side managed by Anthropic; results return automatically.",
  input_schema: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "Search query.",
      },
    },
    required: ["query"],
  },
};

export function buildWebSearchTool(): ToolBuilder {
  return (): Tool => ({
    spec: SPEC,
    dispatch: async (_call: ToolCallInput): Promise<ToolCallResult> => ({
      status: "error",
      output: "web_search is server-side; the runtime should not dispatch it.",
      errorCode: "web_search_local_dispatch",
      errorMessage:
        "web_search is a server-side managed tool — Anthropic should not have routed it back to local dispatch.",
    }),
  });
}
