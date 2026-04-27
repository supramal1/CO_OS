// Cookbook tools for Claude Agent runtime.
//
// At boot time the substrate already loads each agent's persona via
// `loadSystemPrompt` (cookbook.ts). These runtime tools give agents a way
// to fetch *additional* skills mid-task — decision protocols, investigation
// playbooks, handoff conventions — instead of answering from training data.
//
// Locked behaviour:
// - Read-only surface (list_skills, get_skill). Authoring is out of scope
//   for v0 — agents must not create/update/delete skills inside a task.
// - Auth piggy-backs Cornerstone: the same csk_* key that Cookbook MCP
//   accepts is already threaded into ToolBuildContext.cornerstoneApiKey.
// - Errors map to ToolCallResult, never throw.

import { callMcpTool, CookbookError, type SkillDetail } from "../cookbook.js";
import type {
  Tool,
  ToolBuildContext,
  ToolBuilder,
  ToolCallInput,
  ToolCallResult,
  ToolSpec,
} from "../types.js";

// ---------------------------------------------------------------------------
// Tool specs
// ---------------------------------------------------------------------------

const SPECS: Record<string, ToolSpec> = {
  list_skills: {
    name: "list_skills",
    description:
      "List the Cookbook skills (decision protocols, playbooks, handoff conventions) currently available to you. Use this when starting a task to discover relevant procedures before relying on training data.",
    input_schema: {
      type: "object",
      properties: {
        scope_type: {
          type: "string",
          description:
            "Optional filter: 'global', 'team', 'workspace'. Defaults to all scopes you have grants for.",
        },
        tag: {
          type: "string",
          description: "Optional tag filter (e.g. 'investigation', 'handoff').",
        },
      },
      required: [],
    },
  },
  get_skill: {
    name: "get_skill",
    description:
      "Fetch the full body of a Cookbook skill by name. Returns the canonical decision protocol or playbook authored for this team. Use this BEFORE answering from training data when the question matches a skill domain (investigation, handoff, memory hygiene, etc.).",
    input_schema: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "Skill name as returned by list_skills.",
        },
      },
      required: ["name"],
    },
  },
};

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

interface CookbookRuntime {
  readonly apiKey: string;
}

async function dispatch(
  rt: CookbookRuntime,
  name: string,
  input: Record<string, unknown>,
): Promise<ToolCallResult> {
  if (!rt.apiKey) {
    return {
      status: "error",
      output: null,
      errorCode: "cookbook_api_key_missing",
      errorMessage:
        "Cookbook tools require a Cornerstone-issued API key (csk_*) in the invocation context.",
    };
  }
  try {
    switch (name) {
      case "list_skills": {
        const args: Record<string, unknown> = {};
        if (typeof input.scope_type === "string" && input.scope_type)
          args.scope_type = input.scope_type;
        if (typeof input.tag === "string" && input.tag) args.tag = input.tag;
        const out = await callMcpTool<unknown>(rt.apiKey, "list_skills", args);
        return { status: "ok", output: out };
      }
      case "get_skill": {
        const skillName =
          typeof input.name === "string" && input.name.trim().length > 0
            ? input.name
            : null;
        if (!skillName) {
          return {
            status: "error",
            output: null,
            errorCode: "invalid_input",
            errorMessage: "get_skill requires a non-empty 'name' argument.",
          };
        }
        const out = await callMcpTool<SkillDetail>(rt.apiKey, "get_skill", {
          name: skillName,
        });
        return { status: "ok", output: out };
      }
      default:
        return {
          status: "error",
          output: null,
          errorCode: "unknown_tool",
          errorMessage: `Unknown Cookbook tool: ${name}`,
        };
    }
  } catch (err) {
    if (err instanceof CookbookError) {
      return {
        status: "error",
        output: null,
        errorCode: err.status === 401 ? "cookbook_auth_failed" : "cookbook_api_error",
        errorMessage: err.message,
      };
    }
    return {
      status: "error",
      output: null,
      errorCode: "cookbook_api_unreachable",
      errorMessage: err instanceof Error ? err.message : String(err),
    };
  }
}

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

function makeRuntime(ctx: ToolBuildContext): CookbookRuntime {
  return { apiKey: ctx.cornerstoneApiKey };
}

function makeTool(spec: ToolSpec, rt: CookbookRuntime): Tool {
  return {
    spec,
    dispatch: async (call: ToolCallInput) => dispatch(rt, spec.name, call.input),
  };
}

/** Single Cookbook tool builder. agent.toolBuilders.push(cookbookTool('get_skill')). */
export function cookbookTool(toolName: string): ToolBuilder {
  return (ctx: ToolBuildContext): Tool => {
    const spec = SPECS[toolName];
    if (!spec) {
      throw new Error(`cookbookTool: unknown Cookbook tool '${toolName}'`);
    }
    return makeTool(spec, makeRuntime(ctx));
  };
}

/**
 * Default read-only Cookbook surface for every workforce agent: list_skills
 * + get_skill. Mount via `...cookbookToolBuilders()` in an agent's
 * toolBuilders array.
 */
export function cookbookToolBuilders(): ToolBuilder[] {
  return [cookbookTool("list_skills"), cookbookTool("get_skill")];
}

export const ALL_COOKBOOK_TOOL_NAMES: readonly string[] = Object.keys(SPECS);
