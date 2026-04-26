// Grace — Implementer specialist.
//
// Reports to Ada. v0 ships with the GitHub tool surface in addition to the
// Cornerstone read/write tools so Grace can create repos, work on Grace-
// namespace branches, and open PRs that Mal merges via the GitHub UI. The
// grace-system-prompt skill stays in Cookbook and will be updated as a draft
// in `docs/grace-github-tools-decisions.md` until Mal approves the prompt
// addition.

import type { Agent } from "../types.js";
import { AI_OPS_WORKSPACE } from "../types.js";
import {
  cornerstoneToolBuilders,
  cornerstoneTool,
} from "../integrations/cornerstone.js";
import { githubToolBuilders } from "../integrations/github.js";

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
    ...githubToolBuilders("grace"),
  ],
};
