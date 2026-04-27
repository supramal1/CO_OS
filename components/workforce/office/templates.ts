// Pre-built office templates. Adding a team is a 20-line config — no SVG
// edits required.
//
// Default export `aiOpsTeamTemplate` is the CO_OS Workforce v0 roster
// (Ada/Alan/Grace/Margaret/Donald + Cornerstone/Cookbook/Drive/Research)
// which is what /workforce renders. Other templates exist primarily to
// prove the schema is portable; the dev preview route renders them
// side-by-side.

import type { OfficeTemplate } from "./types";

export const aiOpsTeamTemplate: OfficeTemplate = {
  name: "AI Ops",
  agents: [
    // Accents tie each agent to the role they spend the most time in:
    // Ada → cornerstone blue (lead, decisions). Margaret → sage (research).
    // Alan → violet (architecture). Grace → forge red (implementation).
    // Donald → amber (scribe / cookbook).
    //
    // Appearance picks one strong silhouette cue per agent so that five
    // figures at five desks read as five different people from across
    // the room. The cues are loosely tied to role for memorability —
    // glasses on the lead and the architect, headband on the implementer
    // (sleeves rolled), visor on the scribe (record-keeper trope), long
    // hair on the researcher.
    {
      agentId: "ada",
      label: "Ada",
      role: "Lead",
      isLead: true,
      accent: "#76B8E1",
      appearance: {
        skinTone: "#9E7148",
        hairStyle: "bun",
        glasses: true,
      },
    },
    {
      agentId: "margaret",
      label: "Margaret",
      role: "Researcher",
      accent: "#7CB89E",
      appearance: {
        skinTone: "#E6C9A3",
        hairStyle: "long",
      },
    },
    {
      agentId: "alan",
      label: "Alan",
      role: "Architect",
      accent: "#C28BD4",
      appearance: {
        skinTone: "#D9B894",
        hairStyle: "fringe",
        facialHair: "beard",
        glasses: true,
      },
    },
    {
      agentId: "grace",
      label: "Grace",
      role: "Implementer",
      accent: "#E08D5C",
      appearance: {
        skinTone: "#C29A6F",
        hairStyle: "short",
        headwear: "headband",
      },
    },
    {
      agentId: "donald",
      label: "Donald",
      role: "Scribe",
      accent: "#D9A464",
      appearance: {
        skinTone: "#E6C9A3",
        hairStyle: "bald",
        facialHair: "stubble",
        headwear: "visor",
      },
    },
  ],
  stations: [
    { id: "cornerstone", label: "Cornerstone", kind: "monolith" },
    { id: "cookbook", label: "Cookbook", kind: "codex" },
    { id: "drive", label: "Drive", kind: "rack" },
    { id: "research", label: "Research", kind: "globe" },
  ],
};

// Demo: a smaller platform-ops team using three different station kinds
// (cabinet, radar, forge) — there to validate the schema, not to ship.
export const platformOpsTeamTemplate: OfficeTemplate = {
  name: "Platform Ops",
  agents: [
    { agentId: "atlas", label: "Atlas", role: "Director", isLead: true },
    { agentId: "cypher", label: "Cypher", role: "Engineer" },
    { agentId: "probe", label: "Probe", role: "Analyst" },
  ],
  stations: [
    { id: "ledger", label: "Ledger", kind: "cabinet" },
    { id: "watchtower", label: "Watchtower", kind: "radar" },
    { id: "forge", label: "Forge", kind: "forge" },
  ],
};
