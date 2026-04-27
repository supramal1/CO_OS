import type { Principal } from "../../lib/admin-types";

export function filterGrantablePrincipals(
  principals: Principal[],
  existingMemberIds: Set<string>,
): Principal[] {
  return principals.filter(
    (p) => !existingMemberIds.has(p.id) && p.status === "active",
  );
}

export function workspaceGrantSuccessMessage(workspaceName: string): string {
  return `Granted access to ${workspaceName}.`;
}
