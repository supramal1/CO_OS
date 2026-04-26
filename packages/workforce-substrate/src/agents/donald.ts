// Donald — Scribe + Cornerstone hygiene specialist.
//
// Reports to Ada. Owns memory hygiene: dedup analysis (steward_inspect),
// recommendations (steward_advise), preview/apply pipeline. v0 keeps
// steward_apply mounted but the integration returns pending_approval for
// every call — until the approval-queue UI ships, Donald can recommend but
// not execute changes. He still writes facts and conversations directly.

import type { Agent } from "../types.js";
import { AI_OPS_WORKSPACE } from "../types.js";
import { cornerstoneToolBuilders } from "../integrations/cornerstone.js";

export const donald: Agent = {
  id: "donald",
  name: "Donald",
  systemPromptSkill: "donald-system-prompt",
  model: "claude-sonnet-4-6",
  canDelegate: false,
  canUseCornerstoneRead: true,
  canUseCornerstoneWrite: true,
  reportsTo: "ada",
  defaultWorkspace: AI_OPS_WORKSPACE,
  // "donald" scope mounts the steward family in addition to the standard
  // read+write surface. steward_apply is mounted but blocked at the
  // dispatch layer.
  toolBuilders: cornerstoneToolBuilders("donald"),
};
