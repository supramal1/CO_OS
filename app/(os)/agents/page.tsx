import {
  AdminWorkspaceGate,
  AdminWorkspaceProvider,
} from "@/components/admin/workspace-selector";
import { AgentsBoard } from "@/components/agents/agents-board";
import { auth } from "@/auth";
import { listWorkspaces } from "@/lib/cornerstone";

export default async function AgentsPage() {
  const session = await auth();
  if (!session?.isAdmin) {
    return (
      <Placeholder>
        Agents is admin-only. If you need access, ask an admin to enable your
        role.
      </Placeholder>
    );
  }
  const workspaces = session.apiKey ? await listWorkspaces(session.apiKey) : [];
  return (
    <AdminWorkspaceProvider
      principalId={session.principalId}
      workspaces={workspaces}
      adminWorkspaces={workspaces}
    >
      <AdminWorkspaceGate>
        <AgentsBoard />
      </AdminWorkspaceGate>
    </AdminWorkspaceProvider>
  );
}

function Placeholder({ children }: { children: React.ReactNode }) {
  return (
    <section
      style={{
        height: "calc(100vh - var(--shell-h))",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "0 40px",
        textAlign: "center",
      }}
    >
      <p
        style={{
          margin: 0,
          fontFamily: "var(--font-plex-sans)",
          fontSize: 15,
          color: "var(--ink-dim)",
          maxWidth: "44ch",
          lineHeight: 1.55,
        }}
      >
        {children}
      </p>
    </section>
  );
}
