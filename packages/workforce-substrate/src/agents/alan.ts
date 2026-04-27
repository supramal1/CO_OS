// Alan — Architect specialist.
//
// Reports to Ada. Reads Cornerstone for prior decisions, writes facts to
// capture architectural rulings, saves conversations for the why. Web search
// for current-tech checks. No delegation — specialists never delegate in v0.

import type { Agent } from "../types.js";
import { AI_OPS_WORKSPACE } from "../types.js";
import {
  cornerstoneToolBuilders,
  cornerstoneTool,
} from "../integrations/cornerstone.js";
import { buildWebSearchTool } from "../integrations/web-search.js";
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
    ...cornerstoneToolBuilders("read-only"),
    cornerstoneTool("add_fact"),
    cornerstoneTool("save_conversation"),
    // Cookbook reads — Alan loads architecture decision protocols before
    // emitting rulings instead of relying on training-data heuristics.
    ...cookbookToolBuilders(),
    buildWebSearchTool(),
  ],
};
