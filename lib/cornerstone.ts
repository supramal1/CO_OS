import { hasPendingInvitationForEmail } from "./auth-access";

const CORNERSTONE_API_URL =
  process.env.CORNERSTONE_API_URL ?? "https://cornerstone-api-lymgtgeena-nw.a.run.app";

type ResolveEmailResponse = {
  principal_id: string;
  principal_name: string;
  api_key: string;
  created: boolean;
};

type Invitation = {
  email?: string | null;
  status?: string | null;
};

export async function resolveEmailToPrincipal(
  email: string,
  name?: string,
): Promise<ResolveEmailResponse | null> {
  const memoryApiKey = process.env.MEMORY_API_KEY;
  if (!memoryApiKey) {
    console.error("MEMORY_API_KEY not configured");
    return null;
  }

  const res = await fetch(`${CORNERSTONE_API_URL}/admin/auth/resolve-email`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-API-Key": memoryApiKey,
    },
    body: JSON.stringify({ email, name }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "(no body)");
    console.error(`resolve-email failed: ${res.status} ${text}`);
    return null;
  }

  return (await res.json()) as ResolveEmailResponse;
}

export async function hasPendingInvitation(email: string): Promise<boolean> {
  const memoryApiKey = process.env.MEMORY_API_KEY;
  if (!memoryApiKey) return false;

  try {
    const res = await fetch(
      `${CORNERSTONE_API_URL}/admin/invitations?status=pending`,
      {
        headers: {
          "X-API-Key": memoryApiKey,
          "Content-Type": "application/json",
        },
        cache: "no-store",
      },
    );
    if (!res.ok) return false;
    const invitations = (await res.json()) as Invitation[];
    return hasPendingInvitationForEmail(invitations, email);
  } catch (err) {
    console.error("hasPendingInvitation failed:", err);
    return false;
  }
}

export async function checkAdminCapability(principalId: string): Promise<boolean> {
  const memoryApiKey = process.env.MEMORY_API_KEY;
  if (!memoryApiKey) return false;

  try {
    const res = await fetch(
      `${CORNERSTONE_API_URL}/admin/principals/${principalId}/roles`,
      { headers: { "X-API-Key": memoryApiKey } },
    );
    if (!res.ok) return false;
    const roles = (await res.json()) as Array<{ capabilities?: string[] }>;
    return roles.some(
      (r) => Array.isArray(r.capabilities) && r.capabilities.includes("admin"),
    );
  } catch (err) {
    console.error("checkAdminCapability failed:", err);
    return false;
  }
}

export type Workspace = {
  name: string;
  namespace?: string;
  status?: string;
  access_level?: string;
};

function isActiveWorkspace(workspace: Workspace): boolean {
  return workspace.status === undefined || workspace.status === "active";
}

export function workspaceNamesForAdminPanel(workspaces: Workspace[]): string[] {
  return workspaces
    .filter(isActiveWorkspace)
    .map((w) => w.name)
    .filter(Boolean);
}

export function workspaceNamesForAdminInvites(workspaces: Workspace[]): string[] {
  return workspaces
    .filter((w) => isActiveWorkspace(w) && w.access_level === "admin")
    .map((w) => w.name)
    .filter(Boolean);
}

export async function listWorkspaceAccess(apiKey: string): Promise<Workspace[]> {
  try {
    const res = await fetch(`${CORNERSTONE_API_URL}/connection/workspaces`, {
      headers: { "X-API-Key": apiKey, "Content-Type": "application/json" },
      cache: "no-store",
    });
    if (!res.ok) return [];
    const data = (await res.json()) as { workspaces?: Workspace[] };
    return data.workspaces ?? [];
  } catch (err) {
    console.error("listWorkspaceAccess failed:", err);
    return [];
  }
}

export async function listWorkspaces(apiKey: string): Promise<string[]> {
  return workspaceNamesForAdminPanel(await listWorkspaceAccess(apiKey));
}

export async function listAdminInviteWorkspaces(apiKey: string): Promise<string[]> {
  return workspaceNamesForAdminInvites(await listWorkspaceAccess(apiKey));
}

export const CORNERSTONE_URL = CORNERSTONE_API_URL;
