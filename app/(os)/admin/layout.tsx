import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { AdminSubNav } from "@/components/admin-sub-nav";
import {
  AdminWorkspaceGate,
  AdminWorkspaceProvider,
} from "@/components/admin/workspace-selector";
import { authOptions } from "@/lib/auth";
import {
  listWorkspaceAccess,
  workspaceNamesForAdminInvites,
  workspaceNamesForAdminPanel,
} from "@/lib/cornerstone";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getServerSession(authOptions);
  if (!session?.isAdmin) {
    redirect("/speak-to-charlie");
  }
  const workspaceAccess = session.apiKey
    ? await listWorkspaceAccess(session.apiKey)
    : [];
  const workspaces = workspaceNamesForAdminPanel(workspaceAccess);
  const adminWorkspaces = workspaceNamesForAdminInvites(workspaceAccess);

  return (
    <div style={{ display: "flex", flexDirection: "column", minHeight: 0 }}>
      <AdminWorkspaceProvider
        principalId={session.principalId}
        workspaces={workspaces}
        adminWorkspaces={adminWorkspaces}
      >
        <AdminSubNav />
        <AdminWorkspaceGate>{children}</AdminWorkspaceGate>
      </AdminWorkspaceProvider>
    </div>
  );
}
