export type InvitationRequest = {
  email: string;
  role_template: string;
  namespaces: string[];
  notes: string | null;
  pronouns: string;
  job_title: string;
  organization: string;
  team_slugs: string[];
};

export type BuildInvitationRequestInput = {
  email: string;
  role: string;
  namespaces: string[];
  notes: string;
  pronouns: string;
  jobTitle: string;
  organization: string;
  teams: string;
};

export function initialInviteWorkspaceSelection(
  workspaces: string[],
  selectedWorkspace: string | null,
): Set<string> {
  const available = workspaces.map((w) => w.trim()).filter(Boolean);
  if (selectedWorkspace && available.includes(selectedWorkspace)) {
    return new Set([selectedWorkspace]);
  }
  return new Set(available[0] ? [available[0]] : []);
}

export function buildInvitationRequest(
  input: BuildInvitationRequestInput,
): InvitationRequest {
  const teamSlugs = input.teams
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  return {
    email: input.email.trim().toLowerCase(),
    role_template: input.role,
    namespaces: input.namespaces,
    notes: input.notes.trim() || null,
    pronouns: input.pronouns,
    job_title: input.jobTitle.trim(),
    organization: input.organization.trim() || "Charlie Oscar",
    team_slugs: teamSlugs,
  };
}

export function isRoleInvitableFromAdminPanel(role: string): boolean {
  return role === "staff" || role === "workspace_admin" || role === "viewer";
}
