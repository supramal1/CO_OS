"use client";

import { useSession } from "next-auth/react";
import {
  CONNECTED_TOOL_ROWS,
  PROFILE_FACT_ROWS,
  PROFILE_STATS,
  type ConnectedToolRow,
  type ProfileFactRow,
  type ProfileStat,
} from "@/lib/profile/profile-model";

const STATUS_COPY: Record<ConnectedToolRow["status"], string> = {
  coming_next: "Coming next",
  connected: "Connected",
  needs_setup: "Needs setup",
};

export function ProfileShell() {
  const { data: session } = useSession();
  const name = session?.user?.name ?? session?.user?.email ?? "CO OS user";
  const email = session?.user?.email ?? "No email available";
  const initials = initialsFromName(name);

  return (
    <div
      style={{
        minHeight: "calc(100vh - var(--shell-h))",
        background: "var(--paper)",
        color: "var(--ink)",
      }}
    >
      <div
        style={{
          maxWidth: 1280,
          margin: "0 auto",
          padding: "34px 32px 56px",
        }}
      >
        <header>
          <MetaLabel>My OS Profile</MetaLabel>
          <h1
            style={{
              margin: "8px 0 0",
              maxWidth: 620,
              fontFamily: "var(--font-plex-serif)",
              fontSize: 38,
              lineHeight: 1.08,
              fontWeight: 400,
              color: "var(--ink)",
            }}
          >
            Identity, relevance, and connected tools
          </h1>
        </header>

        <IdentityStrip name={name} email={email} initials={initials} />

        <div
          className="profile-layout"
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(320px, 0.8fr) minmax(0, 1.2fr)",
            gap: 48,
            alignItems: "start",
            marginTop: 42,
          }}
        >
          <div style={{ display: "grid", gap: 36 }}>
            <ProfileSection title="My Work" meta="Relevance">
              <FactList rows={PROFILE_FACT_ROWS.slice(0, 3)} />
            </ProfileSection>

            <ProfileSection title="Personalisation + Privacy" meta="Rules">
              <FactList rows={PROFILE_FACT_ROWS.slice(3)} />
            </ProfileSection>
          </div>

          <ProfileSection title="Connected Tools" meta="Infrastructure">
            <ToolList />
            <div
              style={{
                display: "flex",
                gap: 8,
                flexWrap: "wrap",
                marginTop: 14,
              }}
            >
              <QuietButton>Reconnect tool</QuietButton>
              <QuietButton>Review privacy</QuietButton>
            </div>
          </ProfileSection>
        </div>

        <footer
          className="profile-footer"
          style={{
            marginTop: 54,
            paddingTop: 18,
            borderTop: "1px solid var(--rule)",
            display: "flex",
            justifyContent: "space-between",
            gap: 20,
            fontFamily: "var(--font-plex-mono)",
            fontSize: 10,
            letterSpacing: "0.12em",
            textTransform: "uppercase",
            color: "var(--ink-faint)",
          }}
        >
          <span>Profile is personal infrastructure</span>
          <span>Integrations stay invisible until useful</span>
        </footer>
      </div>
      <style jsx>{`
        @media (max-width: 920px) {
          .profile-layout {
            grid-template-columns: 1fr !important;
            gap: 36px !important;
          }

          .profile-footer {
            flex-direction: column;
            gap: 8px !important;
          }
        }
      `}</style>
    </div>
  );
}

function IdentityStrip({
  name,
  email,
  initials,
}: {
  name: string;
  email: string;
  initials: string;
}) {
  return (
    <section
      className="identity-strip"
      style={{
        marginTop: 34,
        padding: "22px 0",
        borderTop: "1px solid var(--rule)",
        borderBottom: "1px solid var(--rule)",
        display: "grid",
        gridTemplateColumns: "auto minmax(0, 1fr) auto",
        gap: 28,
        alignItems: "center",
      }}
    >
      <div
        style={{
          width: 64,
          height: 64,
          border: "1px solid var(--rule-2)",
          borderRadius: 4,
          display: "grid",
          placeItems: "center",
          fontFamily: "var(--font-plex-mono)",
          fontSize: 16,
          letterSpacing: "0.06em",
          color: "var(--ink-dim)",
          background: "var(--panel)",
        }}
      >
        {initials}
      </div>
      <div style={{ minWidth: 0, display: "grid", gap: 4 }}>
        <div
          style={{
            fontFamily: "var(--font-plex-serif)",
            fontSize: 24,
            lineHeight: 1.1,
            color: "var(--ink)",
          }}
        >
          {name}
        </div>
        <div
          style={{
            fontFamily: "var(--font-plex-mono)",
            fontSize: 11,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            color: "var(--ink-faint)",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {email}
        </div>
      </div>
      <div
        className="identity-stats"
        style={{
          display: "flex",
          gap: 28,
          borderLeft: "1px solid var(--rule)",
          paddingLeft: 28,
        }}
      >
        {PROFILE_STATS.map((stat) => (
          <StatBlock key={stat.label} stat={stat} />
        ))}
      </div>
      <style jsx>{`
        @media (max-width: 780px) {
          .identity-strip {
            grid-template-columns: auto minmax(0, 1fr) !important;
          }

          .identity-stats {
            grid-column: 1 / -1;
            border-left: 0 !important;
            border-top: 1px solid var(--rule);
            padding-left: 0 !important;
            padding-top: 18px;
            display: grid !important;
            grid-template-columns: repeat(3, minmax(0, 1fr));
            gap: 16px !important;
          }
        }

        @media (max-width: 520px) {
          .identity-strip {
            grid-template-columns: 1fr !important;
          }

          .identity-stats {
            grid-template-columns: 1fr !important;
          }
        }
      `}</style>
    </section>
  );
}

function StatBlock({ stat }: { stat: ProfileStat }) {
  return (
    <div style={{ minWidth: 92, display: "grid", gap: 2 }}>
      <MetaLabel>{stat.label}</MetaLabel>
      <div
        style={{
          fontFamily: "var(--font-plex-serif)",
          fontSize: 22,
          lineHeight: 1.1,
          color: "var(--ink)",
        }}
      >
        {stat.value}
      </div>
      {stat.subValue ? (
        <div
          style={{
            fontFamily: "var(--font-plex-mono)",
            fontSize: 10,
            color: "var(--ink-dim)",
          }}
        >
          {stat.subValue}
        </div>
      ) : null}
    </div>
  );
}

function ProfileSection({
  title,
  meta,
  children,
}: {
  title: string;
  meta: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          gap: 16,
          marginBottom: 14,
        }}
      >
        <h2
          style={{
            margin: 0,
            fontFamily: "var(--font-plex-serif)",
            fontSize: 22,
            lineHeight: 1.1,
            fontWeight: 400,
            color: "var(--ink)",
          }}
        >
          {title}
        </h2>
        <MetaLabel>{meta}</MetaLabel>
      </div>
      {children}
    </section>
  );
}

function FactList({ rows }: { rows: ProfileFactRow[] }) {
  return (
    <div style={{ borderTop: "1px solid var(--rule)", display: "grid" }}>
      {rows.map((row) => (
        <div
          key={row.label}
          className="fact-row"
          style={{
            display: "grid",
            gridTemplateColumns: "132px minmax(0, 1fr) auto",
            gap: 16,
            alignItems: "baseline",
            padding: "13px 0",
            borderBottom: "1px solid var(--rule)",
          }}
        >
          <MetaLabel>{row.label}</MetaLabel>
          <div
            style={{
              minWidth: 0,
              fontFamily: "var(--font-plex-sans)",
              fontSize: 14,
              color: "var(--ink)",
            }}
          >
            {row.value}
            {row.subValue ? (
              <span
                style={{
                  display: "block",
                  marginTop: 2,
                  fontSize: 12,
                  lineHeight: 1.45,
                  color: "var(--ink-dim)",
                }}
              >
                {row.subValue}
              </span>
            ) : null}
          </div>
          {row.actionLabel ? <RowAction>{row.actionLabel}</RowAction> : <span />}
        </div>
      ))}
      <style jsx>{`
        @media (max-width: 640px) {
          .fact-row {
            grid-template-columns: 1fr !important;
            gap: 6px !important;
            align-items: start !important;
          }
        }
      `}</style>
    </div>
  );
}

function ToolList() {
  return (
    <div style={{ borderTop: "1px solid var(--rule)", display: "grid" }}>
      {CONNECTED_TOOL_ROWS.map((tool) => (
        <ToolRow key={tool.id} tool={tool} />
      ))}
    </div>
  );
}

function ToolRow({ tool }: { tool: ConnectedToolRow }) {
  return (
    <div
      className="tool-row"
      style={{
        display: "grid",
        gridTemplateColumns: "36px minmax(0, 1fr) 108px auto",
        gap: 16,
        alignItems: "center",
        padding: "16px 4px",
        borderBottom: "1px solid var(--rule)",
      }}
    >
      <div
        style={{
          width: 32,
          height: 32,
          border: "1px solid var(--rule-2)",
          borderRadius: 4,
          display: "grid",
          placeItems: "center",
          fontFamily: "var(--font-plex-mono)",
          fontSize: 10,
          color: "var(--ink-dim)",
          background: "var(--panel)",
        }}
      >
        {tool.label.slice(0, 2).toUpperCase()}
      </div>
      <div style={{ minWidth: 0, display: "grid", gap: 2 }}>
        <strong
          style={{
            fontFamily: "var(--font-plex-sans)",
            fontSize: 14,
            lineHeight: 1.35,
            fontWeight: 500,
            color: "var(--ink)",
          }}
        >
          {tool.label}
        </strong>
        <span
          style={{
            fontFamily: "var(--font-plex-sans)",
            fontSize: 12,
            lineHeight: 1.4,
            color: "var(--ink-dim)",
          }}
        >
          {tool.role}
        </span>
      </div>
      <div
        style={{
          fontFamily: "var(--font-plex-mono)",
          fontSize: 10,
          letterSpacing: "0.1em",
          textTransform: "uppercase",
          color: "var(--ink-faint)",
          textAlign: "right",
        }}
      >
        {tool.meta}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <StatusPill status={tool.status} />
        <RowAction>{tool.actionLabel}</RowAction>
      </div>
      <style jsx>{`
        @media (max-width: 720px) {
          .tool-row {
            grid-template-columns: 36px minmax(0, 1fr) !important;
          }

          .tool-row > :nth-child(3),
          .tool-row > :nth-child(4) {
            grid-column: 2;
            justify-self: start;
            text-align: left !important;
          }
        }
      `}</style>
    </div>
  );
}

function StatusPill({ status }: { status: ConnectedToolRow["status"] }) {
  return (
    <span
      style={{
        fontFamily: "var(--font-plex-mono)",
        fontSize: 10,
        letterSpacing: "0.1em",
        textTransform: "uppercase",
        color: status === "connected" ? "var(--c-cornerstone)" : "var(--ink-dim)",
        border: "1px solid var(--rule-2)",
        padding: "3px 7px",
        whiteSpace: "nowrap",
      }}
    >
      {STATUS_COPY[status]}
    </span>
  );
}

function QuietButton({ children }: { children: React.ReactNode }) {
  return (
    <button
      type="button"
      style={{
        fontFamily: "var(--font-plex-mono)",
        fontSize: 11,
        letterSpacing: "0.06em",
        color: "var(--ink-dim)",
        padding: "7px 11px",
        border: "1px solid var(--rule-2)",
      }}
    >
      {children}
    </button>
  );
}

function RowAction({ children }: { children: React.ReactNode }) {
  return (
    <button
      type="button"
      style={{
        fontFamily: "var(--font-plex-mono)",
        fontSize: 11,
        letterSpacing: "0.06em",
        color: "var(--ink-dim)",
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </button>
  );
}

function MetaLabel({ children }: { children: React.ReactNode }) {
  return (
    <span
      style={{
        fontFamily: "var(--font-plex-mono)",
        fontSize: 10,
        letterSpacing: "0.16em",
        textTransform: "uppercase",
        color: "var(--ink-faint)",
      }}
    >
      {children}
    </span>
  );
}

function initialsFromName(name: string): string {
  const parts = name
    .split(/\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
  const initials = parts
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("");
  return initials || "CO";
}
