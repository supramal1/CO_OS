// Grace — Implementer specialist.
//
// Reports to Ada. Grace is implementation-only: GitHub tools are mounted for
// grace/* branch work, and Cornerstone/Cookbook tools stay off this surface.

import type { Agent } from "../types.js";
import { AI_OPS_WORKSPACE } from "../types.js";
import { githubToolBuilders } from "../integrations/github.js";

export const grace: Agent = {
  id: "grace",
  name: "Grace",
  systemPromptSkill: "grace-system-prompt",
  model: "claude-sonnet-4-6",
  canDelegate: false,
  canUseCornerstoneRead: false,
  canUseCornerstoneWrite: false,
  reportsTo: "ada",
  defaultWorkspace: AI_OPS_WORKSPACE,
  toolBuilders: [
    ...githubToolBuilders("grace"),
  ],
};
