"use client";

import {
  CONNECTED_TOOL_ROWS,
  PROFILE_SECTIONS,
  type ConnectedToolRow,
} from "@/lib/profile/profile-model";

const STATUS_COPY: Record<ConnectedToolRow["status"], string> = {
  coming_next: "Coming next",
  connected: "Connected",
  needs_setup: "Needs setup",
};

export function ProfileShell() {
  return (
    <div
      style={{
        minHeight: "calc(100vh - var(--shell-h))",
        background: "var(--paper)",
        color: "var(--ink)",
      }}
    >
      <header
        style={{
          padding: "22px 28px 16px",
          borderBottom: "1px solid var(--rule)",
        }}
      >
        <MetaLabel>My OS Profile</MetaLabel>
        <h1
          style={{
            margin: "6px 0 0",
            fontFamily: "var(--font-plex-serif)",
            fontSize: 30,
            lineHeight: 1.05,
            fontWeight: 400,
          }}
        >
          Identity, relevance, and connected tools
        </h1>
      </header>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0, 1fr) minmax(300px, 380px)",
          minHeight: 0,
        }}
      >
        <main
          style={{
            padding: "20px 28px 28px",
            display: "grid",
            alignContent: "start",
            gap: 20,
            borderRight: "1px solid var(--rule)",
          }}
        >
          {PROFILE_SECTIONS.map((section) => (
            <section key={section.id} style={{ display: "grid", gap: 7 }}>
              <MetaLabel>{section.title}</MetaLabel>
              <p
                style={{
                  margin: 0,
                  maxWidth: 760,
                  fontFamily: "var(--font-plex-sans)",
                  fontSize: 14,
                  lineHeight: 1.5,
                  color: "var(--ink-dim)",
                }}
              >
                {section.description}
              </p>
            </section>
          ))}
        </main>

        <aside
          style={{
            padding: 20,
            display: "grid",
            alignContent: "start",
            gap: 12,
            background: "var(--panel)",
          }}
        >
          <MetaLabel>Connected Tools</MetaLabel>
          <div style={{ display: "grid", gap: 8 }}>
            {CONNECTED_TOOL_ROWS.map((tool) => (
              <ToolRow key={tool.id} tool={tool} />
            ))}
          </div>
        </aside>
      </div>
    </div>
  );
}

function ToolRow({ tool }: { tool: ConnectedToolRow }) {
  return (
    <div
      style={{
        borderTop: "1px solid var(--rule)",
        paddingTop: 9,
        display: "grid",
        gap: 4,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          gap: 12,
        }}
      >
        <strong
          style={{
            fontFamily: "var(--font-plex-sans)",
            fontSize: 13,
            lineHeight: 1.35,
            fontWeight: 500,
          }}
        >
          {tool.label}
        </strong>
        <span
          style={{
            fontFamily: "var(--font-plex-mono)",
            fontSize: 10,
            letterSpacing: "0.12em",
            textTransform: "uppercase",
            color: tool.status === "connected" ? "var(--c-cornerstone)" : "var(--ink-faint)",
          }}
        >
          {STATUS_COPY[tool.status]}
        </span>
      </div>
      <p
        style={{
          margin: 0,
          fontFamily: "var(--font-plex-sans)",
          fontSize: 12,
          lineHeight: 1.45,
          color: "var(--ink-dim)",
        }}
      >
        {tool.role}
      </p>
    </div>
  );
}

function MetaLabel({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontFamily: "var(--font-plex-mono)",
        fontSize: 10,
        letterSpacing: "0.18em",
        textTransform: "uppercase",
        color: "var(--ink-faint)",
      }}
    >
      {children}
    </div>
  );
}
