// Ada — AI Ops workforce Lead.
//
// Lead-only privileges in the v0 roster: canDelegate=true, save_conversation
// for closing out work, web_search for quick lookups. Ada does NOT self-handle
// specialist work — every research/architecture/implementation/hygiene task
// flows through delegate_task per the Cookbook ada-system-prompt skill.

import type { Agent } from "../types.js";
import { AI_OPS_WORKSPACE } from "../types.js";
import {
  cornerstoneToolBuilders,
  cornerstoneTool,
} from "../integrations/cornerstone.js";
import { buildDelegateTaskTool } from "../integrations/delegation.js";
import { buildWebSearchTool } from "../integrations/web-search.js";

export const ada: Agent = {
  id: "ada",
  name: "Ada",
  systemPromptSkill: "ada-system-prompt",
  model: "claude-opus-4-7",
  canDelegate: true,
  canUseCornerstoneRead: true,
  canUseCornerstoneWrite: true,
  reportsTo: undefined,
  defaultWorkspace: AI_OPS_WORKSPACE,
  toolBuilders: [
    // Cornerstone reads for situational awareness before delegation.
    ...cornerstoneToolBuilders("read-only"),
    // Lead writes only save_conversation — Ada synthesises but does not
    // pollute facts directly. add_fact is a specialist responsibility.
    cornerstoneTool("save_conversation"),
    // Lead-only delegation tool.
    buildDelegateTaskTool(),
    // Server-side web search for quick checks Ada can answer herself
    // (per ada-system-prompt: light lookups OK, deep research delegates
    // to Margaret).
    buildWebSearchTool(),
  ],
};
