// Public roster info — agent metadata only, never system prompts or
// tool builder closures.

import { getRoster } from "@workforce/substrate";
import type { PublicAgent } from "./types";

const AGENT_ROLES: Record<string, string> = {
  ada: "Lead — orchestrator, delegates to specialists",
  alan: "Engineering specialist — code, deploys, infra",
  grace: "Engineering specialist — repos, PRs, GitHub",
  margaret: "Research and strategy specialist",
  donald: "Memory steward — Cornerstone audit and curation",
};

export function listPublicAgents(): PublicAgent[] {
  const roster = getRoster();
  return [...roster.values()].map((agent) => ({
    id: agent.id,
    name: agent.name,
    role: AGENT_ROLES[agent.id] ?? "Specialist",
    model: agent.model,
    canDelegate: agent.canDelegate,
    canUseCornerstoneRead: agent.canUseCornerstoneRead,
    canUseCornerstoneWrite: agent.canUseCornerstoneWrite,
    reportsTo: agent.reportsTo,
    defaultWorkspace: agent.defaultWorkspace,
    toolSurface: deriveToolSurface(agent.id, agent.canDelegate),
  }));
}

function deriveToolSurface(agentId: string, canDelegate: boolean): string[] {
  const surface: string[] = [];
  surface.push("cornerstone.read");
  if (agentId !== "donald") surface.push("cornerstone.write");
  if (canDelegate) surface.push("delegate_task");
  if (agentId === "donald") surface.push("steward_*");
  if (agentId === "grace") surface.push("github.*");
  return surface;
}
