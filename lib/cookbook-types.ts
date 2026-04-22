export type ScopeType = "global" | "team" | "client";

export type SkillSummary = {
  name: string;
  description: string;
  scope_type: ScopeType;
  scope_id: string | null;
  owner: string;
  version: string;
  tags: string[];
};

export type SkillDetail = SkillSummary & {
  content: string;
  last_reviewed?: string | null;
};

export type ScopeGroup = {
  type: ScopeType;
  label: string;
  children: { id: string; label: string; count: number }[];
};

export function buildScopeGroups(skills: SkillSummary[]): ScopeGroup[] {
  const globalCount = skills.filter((s) => s.scope_type === "global").length;
  const teamMap = new Map<string, number>();
  const clientMap = new Map<string, number>();
  for (const s of skills) {
    if (s.scope_type === "team" && s.scope_id) {
      teamMap.set(s.scope_id, (teamMap.get(s.scope_id) ?? 0) + 1);
    } else if (s.scope_type === "client" && s.scope_id) {
      clientMap.set(s.scope_id, (clientMap.get(s.scope_id) ?? 0) + 1);
    }
  }
  const teamEntries = Array.from(teamMap.entries()).sort(([a], [b]) =>
    a.localeCompare(b),
  );
  const clientEntries = Array.from(clientMap.entries()).sort(([a], [b]) =>
    a.localeCompare(b),
  );
  return [
    {
      type: "global",
      label: "Global",
      children: [{ id: "global", label: "All global", count: globalCount }],
    },
    {
      type: "team",
      label: "Teams",
      children: teamEntries.map(([id, count]) => ({ id, label: id, count })),
    },
    {
      type: "client",
      label: "Clients",
      children: clientEntries.map(([id, count]) => ({ id, label: id, count })),
    },
  ];
}
