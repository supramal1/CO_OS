import { listWorkspaces } from "./cornerstone";

export type ForgeNamespaceResult =
  | { ok: true; namespace: string }
  | { ok: false; status: number; error: string };

export function chooseForgeNamespace(
  workspaces: string[],
  requested?: string | null,
): ForgeNamespaceResult {
  const normalized = Array.from(
    new Set(workspaces.map((workspace) => workspace.trim()).filter(Boolean)),
  ).sort((a, b) => a.localeCompare(b));

  const requestedNamespace = requested?.trim();
  if (requestedNamespace) {
    if (normalized.includes(requestedNamespace)) {
      return { ok: true, namespace: requestedNamespace };
    }
    return { ok: false, status: 403, error: "workspace_not_granted" };
  }

  if (normalized.length === 0) {
    return { ok: false, status: 403, error: "no_workspace_access" };
  }
  if (normalized.includes("default")) {
    return { ok: true, namespace: "default" };
  }
  return { ok: true, namespace: normalized[0] };
}

export async function resolveForgeNamespace(
  apiKey: string,
  requested?: string | null,
): Promise<ForgeNamespaceResult> {
  return chooseForgeNamespace(await listWorkspaces(apiKey), requested);
}
