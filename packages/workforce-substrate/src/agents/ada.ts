// Ada — AI Ops workforce Lead.
//
// Lead-only privileges in the v0 roster: canDelegate=true, save_conversation
// for closing out work, and routing-scoped add_fact. Ada does NOT self-handle
// specialist work — every research/architecture/implementation/hygiene task
// flows through delegate_task per the Cookbook ada-system-prompt skill.

import type { Agent } from "../types.js";
import { AI_OPS_WORKSPACE } from "../types.js";
import { cornerstoneTool } from "../integrations/cornerstone.js";
import { buildDelegateTaskTool } from "../integrations/delegation.js";
import { cookbookToolBuilders } from "../integrations/cookbook.js";

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
    // Cornerstone reads for situational awareness before delegation. Keep the
    // list explicit so Ada does not inherit steward tools.
    cornerstoneTool("get_context"),
    cornerstoneTool("search"),
    cornerstoneTool("list_facts"),
    cornerstoneTool("recall"),
    // Lead writes are scoped to routing facts and conversation close-out.
    cornerstoneTool("add_fact"),
    cornerstoneTool("save_conversation"),
    // Cookbook reads — Ada checks decision protocols before delegating
    // (e.g. agent-handoff-protocol) instead of answering from training data.
    ...cookbookToolBuilders(),
    // Lead-only delegation tool.
    buildDelegateTaskTool(),
  ],
};
