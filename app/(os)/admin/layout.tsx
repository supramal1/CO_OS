import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { AdminSubNav } from "@/components/admin-sub-nav";
import {
  AdminWorkspaceGate,
  AdminWorkspaceProvider,
} from "@/components/admin/workspace-selector";
import { authOptions } from "@/lib/auth";
import { listWorkspaces } from "@/lib/cornerstone";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getServerSession(authOptions);
  if (!session?.isAdmin) {
    redirect("/speak-to-charlie");
  }
  const workspaces = session.apiKey ? await listWorkspaces(session.apiKey) : [];

  return (
    <div style={{ display: "flex", flexDirection: "column", minHeight: 0 }}>
      <AdminWorkspaceProvider
        principalId={session.principalId}
        workspaces={workspaces}
      >
        <AdminSubNav />
        <AdminWorkspaceGate>{children}</AdminWorkspaceGate>
      </AdminWorkspaceProvider>
    </div>
  );
}
