// v0 AI Ops workforce roster.
//
// Static — the substrate has no DB. Roster shape MUST satisfy:
//  - Exactly one Lead (canDelegate=true).
//  - Every non-Lead has reportsTo set to a roster agent's id.
//  - reportsTo cannot point to a missing agent.
//  - No reportsTo cycles.
//  - delegate_task is mounted ONLY on the Lead.
//
// validateRoster() is called at runtime entry (CLI + invokeAgent) so a
// misconfigured roster fails fast rather than producing surprising tool
// dispatch errors mid-conversation.

import type { Agent } from "./types.js";
import { ada } from "./agents/ada.js";
import { alan } from "./agents/alan.js";
import { grace } from "./agents/grace.js";
import { margaret } from "./agents/margaret.js";
import { donald } from "./agents/donald.js";

const ROSTER: readonly Agent[] = [ada, alan, grace, margaret, donald];

const ROSTER_MAP: ReadonlyMap<string, Agent> = new Map(
  ROSTER.map((a) => [a.id, a] as const),
);

export function getRoster(): ReadonlyMap<string, Agent> {
  return ROSTER_MAP;
}

export function getAgent(idOrName: string): Agent | undefined {
  const lowered = idOrName.toLowerCase();
  const direct = ROSTER_MAP.get(lowered);
  if (direct) return direct;
  for (const agent of ROSTER) {
    if (agent.id.toLowerCase() === lowered) return agent;
    if (agent.name.toLowerCase() === lowered) return agent;
  }
  return undefined;
}

export interface RosterValidationError {
  readonly code: string;
  readonly message: string;
}

export interface RosterValidationResult {
  readonly ok: boolean;
  readonly errors: readonly RosterValidationError[];
  readonly leadId?: string;
}

export function validateRoster(
  roster: ReadonlyMap<string, Agent> = ROSTER_MAP,
): RosterValidationResult {
  const errors: RosterValidationError[] = [];
  const ids = new Set(roster.keys());

  // Exactly one Lead.
  const leads = [...roster.values()].filter((a) => a.canDelegate);
  if (leads.length === 0) {
    errors.push({
      code: "no_lead",
      message: "Roster has no Lead — exactly one agent must have canDelegate=true.",
    });
  } else if (leads.length > 1) {
    errors.push({
      code: "multiple_leads",
      message: `Roster has ${leads.length} Leads (${leads
        .map((l) => l.id)
        .join(", ")}); v0 supports exactly one.`,
    });
  }

  // reportsTo invariants.
  for (const agent of roster.values()) {
    if (agent.canDelegate) {
      if (agent.reportsTo) {
        errors.push({
          code: "lead_reports_to",
          message: `Lead '${agent.id}' has reportsTo='${agent.reportsTo}' but Lead must have no reportsTo.`,
        });
      }
      continue;
    }
    if (!agent.reportsTo) {
      errors.push({
        code: "missing_reports_to",
        message: `Agent '${agent.id}' is not Lead and has no reportsTo.`,
      });
      continue;
    }
    if (!ids.has(agent.reportsTo)) {
      errors.push({
        code: "dangling_reports_to",
        message: `Agent '${agent.id}' reports to '${agent.reportsTo}' which is not in the roster.`,
      });
    }
  }

  // Cycle detection — walk reportsTo chains, abort at depth > roster.size.
  for (const agent of roster.values()) {
    let cursor: Agent | undefined = agent;
    const visited = new Set<string>();
    let steps = 0;
    while (cursor?.reportsTo) {
      if (visited.has(cursor.id)) {
        errors.push({
          code: "reports_to_cycle",
          message: `reportsTo cycle detected starting at agent '${agent.id}'.`,
        });
        break;
      }
      visited.add(cursor.id);
      const next: Agent | undefined = roster.get(cursor.reportsTo);
      if (!next) break; // dangling already reported above
      cursor = next;
      if (++steps > roster.size) {
        errors.push({
          code: "reports_to_cycle",
          message: `reportsTo chain from '${agent.id}' exceeded roster size — likely cycle.`,
        });
        break;
      }
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    leadId: leads.length === 1 ? leads[0]!.id : undefined,
  };
}
