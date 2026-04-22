"use client";

import { useSession } from "next-auth/react";
import { AgentsBoard } from "@/components/agents/agents-board";

export default function AgentsPage() {
  const { data: session, status } = useSession();

  if (status === "loading") {
    return <Placeholder>Loading…</Placeholder>;
  }
  if (!session?.isAdmin) {
    return (
      <Placeholder>
        Agents is admin-only. If you need access, ask an admin to enable your
        role.
      </Placeholder>
    );
  }
  return <AgentsBoard />;
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
