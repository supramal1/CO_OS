// Tool name → office station id.
//
// Substrate tool names are stable strings emitted in tool_called
// events. The pixel office turns those into "the agent walked over to
// station X" for the duration of the call. Tools that don't map to a
// physical station (delegate_task, anthropic native tools, anything
// the office hasn't modelled yet) return undefined — the agent stays
// at their desk in working state.
//
// Keeping this as a pure prefix/exact map (no regex) so it stays cheap
// to evaluate on every poll cycle and easy to extend when we add new
// tools or stations.

const PREFIX_RULES: { prefix: string; stationId: string }[] = [
  { prefix: "github_", stationId: "drive" },
];

const EXACT_RULES: Record<string, string> = {
  // Cornerstone surface — every memory tool routes the sprite over
  // to the cornerstone monolith.
  get_context: "cornerstone",
  search: "cornerstone",
  recall: "cornerstone",
  remember: "cornerstone",
  forget: "cornerstone",
  list_facts: "cornerstone",
  list_notes: "cornerstone",
  add_fact: "cornerstone",
  add_note: "cornerstone",
  save_conversation: "cornerstone",
  steward_inspect: "cornerstone",
  steward_advise: "cornerstone",
  steward_preview: "cornerstone",
  steward_apply: "cornerstone",
  steward_status: "cornerstone",

  // Research surface — the globe-shaped station up by Margaret's desk.
  web_search: "research",

  // Cookbook surface — no substrate tools yet, but reserve the names
  // we'd emit so the station lights up the moment they're added.
  list_skills: "cookbook",
  get_skill: "cookbook",
  test_skill: "cookbook",
};

export function stationForTool(toolName: string): string | undefined {
  const exact = EXACT_RULES[toolName];
  if (exact) return exact;
  for (const { prefix, stationId } of PREFIX_RULES) {
    if (toolName.startsWith(prefix)) return stationId;
  }
  return undefined;
}

// Tool name → semantic family for the working-state glyph.
//
// Distinct from `stationForTool`: a station is a physical destination
// (the sprite walks there), a family is a *kind* of thing (the sprite
// stays at their desk and a small glyph above their head says what
// they're doing). delegate_task has no station — but the glyph above
// Ada's head when she's delegating should look different from the
// glyph above her head when she's just thinking.
import type { ToolFamily } from "./types";

const FAMILY_PREFIX_RULES: { prefix: string; family: ToolFamily }[] = [
  { prefix: "github_", family: "build" },
  { prefix: "steward_", family: "memory" },
];

const FAMILY_EXACT_RULES: Record<string, ToolFamily> = {
  // Memory
  get_context: "memory",
  search: "memory",
  recall: "memory",
  remember: "memory",
  forget: "memory",
  list_facts: "memory",
  list_notes: "memory",
  add_fact: "memory",
  add_note: "memory",
  save_conversation: "memory",
  // Research
  web_search: "research",
  // Cookbook
  list_skills: "cookbook",
  get_skill: "cookbook",
  test_skill: "cookbook",
  // Delegation
  delegate_task: "delegate",
};

export function toolFamilyForTool(toolName: string): ToolFamily | undefined {
  const exact = FAMILY_EXACT_RULES[toolName];
  if (exact) return exact;
  for (const { prefix, family } of FAMILY_PREFIX_RULES) {
    if (toolName.startsWith(prefix)) return family;
  }
  return undefined;
}
