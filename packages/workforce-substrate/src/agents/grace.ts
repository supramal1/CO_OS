// Grace — Implementer specialist.
//
// Reports to Ada. v0 ships without real coding tools — Grace gets the
// Cornerstone read/write surface so she can record findings and decisions,
// but the file/git/test/PR toolchain lands in a follow-up sprint. The
// grace-system-prompt skill flags this constraint to the model so it knows
// not to hallucinate file edits.

import type { Agent } from "../types.js";
import { AI_OPS_WORKSPACE } from "../types.js";
import {
  cornerstoneToolBuilders,
  cornerstoneTool,
} from "../integrations/cornerstone.js";

export const grace: Agent = {
  id: "grace",
  name: "Grace",
  systemPromptSkill: "grace-system-prompt",
  model: "claude-sonnet-4-6",
  canDelegate: false,
  canUseCornerstoneRead: true,
  canUseCornerstoneWrite: true,
  reportsTo: "ada",
  defaultWorkspace: AI_OPS_WORKSPACE,
  toolBuilders: [
    ...cornerstoneToolBuilders("read-only"),
    cornerstoneTool("add_fact"),
    cornerstoneTool("save_conversation"),
  ],
};
