// Alan — Architect specialist.
//
// Reports to Ada. Reads Cornerstone for prior decisions and saves
// conversations for the why. No delegation — specialists never delegate in v0.

import type { Agent } from "../types.js";
import { AI_OPS_WORKSPACE } from "../types.js";
import { cornerstoneTool } from "../integrations/cornerstone.js";
import { cookbookToolBuilders } from "../integrations/cookbook.js";

export const alan: Agent = {
  id: "alan",
  name: "Alan",
  systemPromptSkill: "alan-system-prompt",
  model: "claude-opus-4-7",
  canDelegate: false,
  canUseCornerstoneRead: true,
  canUseCornerstoneWrite: true,
  reportsTo: "ada",
  defaultWorkspace: AI_OPS_WORKSPACE,
  toolBuilders: [
    // Explicit read surface only; do not inherit steward tools.
    cornerstoneTool("get_context"),
    cornerstoneTool("search"),
    cornerstoneTool("list_facts"),
    cornerstoneTool("recall"),
    cornerstoneTool("save_conversation"),
    // Cookbook reads — Alan loads architecture decision protocols before
    // emitting rulings instead of relying on training-data heuristics.
    ...cookbookToolBuilders(),
  ],
};
