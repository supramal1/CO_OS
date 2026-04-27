// Margaret — Researcher specialist.
//
// Reports to Ada. Pure research role: web_search is her only tool. She does
// NOT write to Cornerstone — research outputs come back to Ada as the child
// task's final text, and Ada is responsible for capturing the synthesis
// (save_conversation) or any durable findings (delegate to Donald for hygiene
// later if needed). This keeps Margaret's output structured and citable.

import type { Agent } from "../types.js";
import { AI_OPS_WORKSPACE } from "../types.js";
import { buildWebSearchTool } from "../integrations/web-search.js";
import { cookbookToolBuilders } from "../integrations/cookbook.js";

export const margaret: Agent = {
  id: "margaret",
  name: "Margaret",
  systemPromptSkill: "margaret-system-prompt",
  model: "claude-sonnet-4-6",
  canDelegate: false,
  canUseCornerstoneRead: false,
  canUseCornerstoneWrite: false,
  // Research deliverables are long structured output by design — needs
  // the larger per-turn cap so the briefing isn't truncated mid-section.
  outputHeavy: true,
  reportsTo: "ada",
  defaultWorkspace: AI_OPS_WORKSPACE,
  toolBuilders: [
    // Cookbook reads — Margaret pulls how-to-run-investigation and any
    // research playbooks before answering. Forces tool-use over training-
    // data-only responses.
    ...cookbookToolBuilders(),
    buildWebSearchTool(),
  ],
};
