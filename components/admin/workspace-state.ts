export type WorkspaceSelectionState = {
  workspaces: string[];
  selectedWorkspace: string | null;
};

export function normalizeWorkspaces(workspaces: string[]): string[] {
  return Array.from(
    new Set(workspaces.map((workspace) => workspace.trim()).filter(Boolean)),
  ).sort((a, b) => a.localeCompare(b));
}

export function addAndSelectWorkspace(
  workspaces: string[],
  workspace: string,
): WorkspaceSelectionState {
  const normalized = normalizeWorkspaces(workspaces);
  const nextWorkspace = workspace.trim();

  if (!nextWorkspace) {
    return {
      workspaces: normalized,
      selectedWorkspace: normalized[0] ?? null,
    };
  }

  return {
    workspaces: normalizeWorkspaces([...normalized, nextWorkspace]),
    selectedWorkspace: nextWorkspace,
  };
}
