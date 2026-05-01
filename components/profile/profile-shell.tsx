"use client";

import { useCallback, useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import {
  CONNECTED_TOOL_ROWS,
  PROFILE_FACT_ROWS,
  PROFILE_STATS,
  getConnectedToolDisplay,
  type ConnectedToolAction,
  type ConnectedToolRow,
  type ProfileFactRow,
  type ProfilePersonalisationCard,
  type ProfilePersonalisationSnapshot,
  type ProfileSnapshot,
  type ProfileStat,
} from "@/lib/profile/profile-model";

type ProfileLoadState =
  | { status: "loading" }
  | { status: "loaded"; profile: ProfileSnapshot }
  | { status: "error"; message: string };

export function ProfileShell({
  initialProfile = null,
  refreshOnMount = false,
}: {
  initialProfile?: ProfileSnapshot | null;
  refreshOnMount?: boolean;
}) {
  const { data: session, status: sessionStatus } = useSession();
  const [state, setState] = useState<ProfileLoadState>(
    initialProfile
      ? { status: "loaded", profile: initialProfile }
      : { status: "loading" },
  );
  const [isRefreshing, setIsRefreshing] = useState(refreshOnMount);
  const profile = state.status === "loaded" ? state.profile : null;
  const name =
    profile?.identity.name ??
    session?.user?.name ??
    session?.user?.email ??
    "Signed-in user";
  const email =
    profile?.identity.email ?? session?.user?.email ?? "Login email unavailable";
  const initials = initialsFromName(name);
  const stats = profile?.stats ?? PROFILE_STATS;
  const factRows = profile?.factRows ?? PROFILE_FACT_ROWS;
  const connectedTools = profile?.connectedTools ?? CONNECTED_TOOL_ROWS;
  const connectorsFreshness = profile?.metadata?.connectors;
  const personalisationFreshness = profile?.metadata?.personalisation;
  const fallbackPersonalisationDetail =
    state.status === "error"
      ? `Profile API: ${state.message}`
      : "Loading latest state.";
  const personalisation = profile?.personalisation ?? {
    cards: [],
    sources: [
      {
        source: "honcho",
        status: "empty",
        label: "Honcho",
        detail: fallbackPersonalisationDetail,
      },
    ],
  };
  const showLoadingState = state.status === "loading" || isRefreshing;

  const refreshProfile = useCallback(
    async (signal?: AbortSignal) => {
      if (!initialProfile && sessionStatus === "loading") return;

      if (!initialProfile && sessionStatus === "unauthenticated") {
        setState((current) =>
          current.status === "loaded"
            ? current
            : {
                status: "error",
                message: "unauthenticated",
              },
        );
        return;
      }

      try {
        setIsRefreshing(true);
        const [connectorsPayload, personalisationPayload] = await Promise.all([
          fetchProfileSegment<{
            connectors?: {
              connectedTools: ProfileSnapshot["connectedTools"];
              stats: ProfileSnapshot["stats"];
              metadata: NonNullable<ProfileSnapshot["metadata"]>["connectors"];
            };
          }>("/api/profile/connectors", signal),
          fetchProfileSegment<{
            personalisation?: {
              personalisation: ProfileSnapshot["personalisation"];
              metadata: NonNullable<ProfileSnapshot["metadata"]>["personalisation"];
            };
          }>("/api/profile/personalisation", signal),
        ]);

        setState((current) => {
          const base =
            current.status === "loaded" ? current.profile : initialProfile ?? null;
          if (!base) {
            return {
              status: "error",
              message: "profile shell unavailable",
            };
          }

          return {
            status: "loaded",
            profile: {
              ...base,
              stats: connectorsPayload.connectors?.stats ?? base.stats,
              connectedTools:
                connectorsPayload.connectors?.connectedTools ??
                base.connectedTools,
              personalisation:
                personalisationPayload.personalisation?.personalisation ??
                base.personalisation,
              metadata: {
                connectors:
                  connectorsPayload.connectors?.metadata ??
                  base.metadata?.connectors ??
                  fallbackFreshness(),
                personalisation:
                  personalisationPayload.personalisation?.metadata ??
                  base.metadata?.personalisation ??
                  fallbackFreshness(),
              },
            },
          };
        });
      } catch (error) {
        if (!signal?.aborted) {
          setState((current) =>
            current.status === "loaded"
              ? current
              : {
                  status: "error",
                  message: error instanceof Error ? error.message : String(error),
                },
          );
        }
      } finally {
        if (!signal?.aborted) {
          setIsRefreshing(false);
        }
      }
    },
    [initialProfile, sessionStatus],
  );

  useEffect(() => {
    const controller = new AbortController();
    if (initialProfile && !refreshOnMount) return () => controller.abort();
    void refreshProfile(controller.signal);
    return () => controller.abort();
  }, [initialProfile, refreshOnMount, refreshProfile]);

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
              maxWidth: 680,
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

        <IdentityStrip
          name={name}
          email={email}
          initials={initials}
          stats={stats}
        />

        {state.status === "error" ? (
          <InlineStatus>
            {state.message === "unauthenticated"
              ? "Profile needs a signed-in CO OS session on this localhost port."
              : `Live profile state is unavailable: ${state.message}. Showing the default Profile structure.`}
          </InlineStatus>
        ) : null}

        <div
          className="profile-layout"
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(320px, 0.82fr) minmax(0, 1.18fr)",
            gap: 52,
            alignItems: "start",
            marginTop: 54,
          }}
        >
          <div style={{ display: "grid", gap: 52 }}>
            <ProfileSection title="My Work" meta="Relevance">
              <FactList rows={factRows.slice(0, 3)} isRefreshing={showLoadingState} />
            </ProfileSection>

            <PersonalisationCard
              personalisation={personalisation}
              isRefreshing={showLoadingState}
              freshness={personalisationFreshness}
            />

            <ProfileSection title="Privacy" meta="Visibility">
              <FactList rows={factRows.slice(3)} isRefreshing={showLoadingState} />
            </ProfileSection>
          </div>

          <ProfileSection title="Connected Tools" meta="Infrastructure">
            <ToolList
              tools={connectedTools}
              isRefreshing={showLoadingState}
              freshness={connectorsFreshness}
              onRefreshProfile={refreshProfile}
            />
            <div
              style={{
                display: "flex",
                gap: 8,
                flexWrap: "wrap",
                marginTop: 18,
              }}
            >
              <QuietButton onClick={() => void refreshProfile()} disabled={isRefreshing}>
                {isRefreshing ? "Loading latest state" : "Refresh state"}
              </QuietButton>
            </div>
          </ProfileSection>
        </div>

        <footer
          className="profile-footer"
          style={{
            marginTop: 58,
            paddingTop: 18,
            borderTop: "1px solid var(--rule)",
            display: "flex",
            justifyContent: "space-between",
            gap: 20,
            minHeight: 28,
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
            gap: 48px !important;
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
  stats,
}: {
  name: string;
  email: string;
  initials: string;
  stats: ProfileStat[];
}) {
  return (
    <section
      className="identity-strip"
      style={{
        marginTop: 34,
        padding: "28px 0",
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
        {stats.map((stat) => (
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
            padding-top: 22px;
            display: grid !important;
            grid-template-columns: repeat(2, minmax(0, 1fr));
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
    <section
      style={{
        paddingTop: 24,
        borderTop: "1px solid var(--rule)",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          gap: 16,
          marginBottom: 20,
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

function FactList({
  rows,
  isRefreshing,
}: {
  rows: ProfileFactRow[];
  isRefreshing: boolean;
}) {
  return (
    <div style={{ display: "grid" }}>
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
            <RowFreshness item={row} isRefreshing={isRefreshing} />
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

function PersonalisationCard({
  personalisation,
  isRefreshing,
  freshness,
}: {
  personalisation: ProfilePersonalisationSnapshot;
  isRefreshing: boolean;
  freshness?: unknown;
}) {
  return (
    <ProfileSection title="What CO OS has learned" meta="Personalisation">
      <div style={{ display: "grid" }}>
        {personalisation.cards.length > 0 ? (
          personalisation.cards.map((card) => (
            <PersonalisationRow
              key={card.id}
              card={card}
              isRefreshing={isRefreshing}
              freshness={freshness}
            />
          ))
        ) : (
          <div
            style={{
              borderBottom: "1px solid var(--rule)",
              padding: "13px 0",
              color: "var(--ink-dim)",
              fontSize: 13,
              lineHeight: 1.45,
            }}
          >
            No learned preferences are ready to show yet. Honcho will start to
            surface patterns from saved conversations and memory writes once
            enough signal exists.
          </div>
        )}
      </div>
      <div
        style={{
          display: "flex",
          gap: 8,
          flexWrap: "wrap",
          marginTop: 12,
        }}
      >
        {personalisation.sources.map((source) => (
          <span
            key={source.source}
            title={source.detail}
            style={{
              border: "1px solid var(--rule-2)",
              padding: "3px 7px",
              fontFamily: "var(--font-plex-mono)",
              fontSize: 10,
              letterSpacing: "0.1em",
              textTransform: "uppercase",
              color:
                source.status === "ok"
                  ? "var(--c-cornerstone)"
                  : "var(--ink-dim)",
            }}
          >
            {source.label} / {sourceStatusLabel(source.status, isRefreshing)}
          </span>
        ))}
      </div>
      {personalisation.sources.some((source) => source.detail || isRefreshing) ? (
        <div
          style={{
            marginTop: 9,
            display: "grid",
            gap: 4,
            color: "var(--ink-faint)",
            fontSize: 12,
            lineHeight: 1.45,
          }}
        >
          {personalisation.sources
            .filter((source) => source.detail || isRefreshing)
            .map((source) => (
              <span key={`${source.source}-detail`}>
                {sourceStatusDetail(source, isRefreshing, freshness)}
              </span>
            ))}
        </div>
      ) : null}
    </ProfileSection>
  );
}

function PersonalisationRow({
  card,
  isRefreshing,
  freshness,
}: {
  card: ProfilePersonalisationCard;
  isRefreshing: boolean;
  freshness?: unknown;
}) {
  return (
    <div
      style={{
        display: "grid",
        gap: 8,
        padding: "14px 0",
        borderBottom: "1px solid var(--rule)",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          gap: 14,
          alignItems: "baseline",
        }}
      >
        <strong
          style={{
            fontFamily: "var(--font-plex-sans)",
            fontSize: 14,
            lineHeight: 1.35,
            fontWeight: 500,
            color: "var(--ink)",
          }}
        >
          {card.title}
        </strong>
        <MetaLabel>
          {card.source} / {card.confidence}
        </MetaLabel>
      </div>
      <p
        style={{
          margin: 0,
          maxHeight: 220,
          overflowY: "auto",
          padding: "8px 10px 8px 0",
          borderTop: "1px solid var(--rule)",
          borderBottom: "1px solid var(--rule)",
          color: "var(--ink-dim)",
          fontSize: 13,
          lineHeight: 1.45,
        }}
      >
        {card.detail}
      </p>
      <RowFreshness item={card} isRefreshing={isRefreshing} freshness={freshness} />
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        {card.actions.map((action) => (
          <RowAction key={`${card.id}-${action}`}>
            {action === "keep" ? "Keep" : action === "correct" ? "Correct" : "Remove"}
          </RowAction>
        ))}
      </div>
    </div>
  );
}

function ToolList({
  tools,
  isRefreshing,
  freshness,
  onRefreshProfile,
}: {
  tools: ConnectedToolRow[];
  isRefreshing: boolean;
  freshness?: unknown;
  onRefreshProfile: () => Promise<void>;
}) {
  return (
    <div style={{ display: "grid" }}>
      {tools.map((tool) => (
        <ToolRow
          key={tool.id}
          tool={tool}
          isRefreshing={isRefreshing}
          freshness={freshness}
          onRefreshProfile={onRefreshProfile}
        />
      ))}
    </div>
  );
}

function ToolRow({
  tool,
  isRefreshing,
  freshness,
  onRefreshProfile,
}: {
  tool: ConnectedToolRow;
  isRefreshing: boolean;
  freshness?: unknown;
  onRefreshProfile: () => Promise<void>;
}) {
  const display = getConnectedToolDisplay(tool);
  const actions = display.actions ?? [
    { label: display.actionLabel, kind: "link" as const, href: display.href },
  ];

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
        {display.detail ? (
          <span
            style={{
              fontFamily: "var(--font-plex-mono)",
              fontSize: 10,
              lineHeight: 1.35,
              color: "var(--ink-faint)",
            }}
          >
            {display.detail}
          </span>
        ) : null}
        <RowFreshness item={tool} isRefreshing={isRefreshing} freshness={freshness} />
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
        {display.meta}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <StatusPill status={display.statusKind} label={display.statusLabel} />
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          {actions.map((action) => (
            <ToolActionButton
              key={`${tool.id}-${action.label}-${action.href ?? action.endpoint ?? "refresh"}`}
              action={action}
              onRefreshProfile={onRefreshProfile}
            />
          ))}
        </div>
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

function ToolActionButton({
  action,
  onRefreshProfile,
}: {
  action: ConnectedToolAction;
  onRefreshProfile: () => Promise<void>;
}) {
  const [state, setState] = useState<"idle" | "working">("idle");

  async function runAction() {
    if (action.kind === "link" && action.href) {
      window.location.href = action.href;
      return;
    }
    if (action.kind === "refresh") {
      setState("working");
      try {
        await onRefreshProfile();
      } finally {
        setState("idle");
      }
      return;
    }
    if (action.kind !== "post" || !action.endpoint) return;

    setState("working");
    try {
      const response = await fetch(action.endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(action.payload ?? {}),
      });
      const payload = (await response.json().catch(() => null)) as
        | { next_url?: string }
        | null;
      if (payload?.next_url) {
        window.location.href = payload.next_url;
        return;
      }
      await onRefreshProfile();
    } finally {
      setState("idle");
    }
  }

  return (
    <button
      type="button"
      onClick={runAction}
      disabled={state === "working"}
      style={{
        fontFamily: "var(--font-plex-mono)",
        fontSize: 10,
        letterSpacing: "0.08em",
        color: "var(--ink-dim)",
        borderBottom: "1px solid var(--rule-2)",
        whiteSpace: "nowrap",
        opacity: state === "working" ? 0.55 : 1,
      }}
    >
      {state === "working" ? "Working" : action.label}
    </button>
  );
}

function StatusPill({
  status,
  label,
}: {
  status: ConnectedToolRow["status"];
  label: string;
}) {
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
      {label}
    </span>
  );
}

function QuietButton({
  children,
  onClick,
  disabled = false,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        fontFamily: "var(--font-plex-mono)",
        fontSize: 11,
        letterSpacing: "0.06em",
        color: "var(--ink-dim)",
        padding: "7px 11px",
        border: "1px solid var(--rule-2)",
        opacity: disabled ? 0.62 : 1,
      }}
    >
      {children}
    </button>
  );
}

function RowAction({
  children,
  href,
}: {
  children: React.ReactNode;
  href?: string;
}) {
  const style = {
    fontFamily: "var(--font-plex-mono)",
    fontSize: 11,
    letterSpacing: "0.06em",
    color: "var(--ink-dim)",
    whiteSpace: "nowrap",
  };

  if (href) {
    return (
      <a href={href} style={style}>
        {children}
      </a>
    );
  }

  return (
    <button type="button" style={style}>
      {children}
    </button>
  );
}

function RowFreshness({
  item,
  isRefreshing,
  freshness,
}: {
  item: unknown;
  isRefreshing: boolean;
  freshness?: unknown;
}) {
  const lastChecked = lastCheckedText(freshness) ?? lastCheckedText(item);
  if (!isRefreshing && !lastChecked) return null;

  return (
    <span
      role={isRefreshing ? "status" : undefined}
      style={{
        display: "block",
        marginTop: 4,
        fontFamily: "var(--font-plex-mono)",
        fontSize: 10,
        lineHeight: 1.35,
        letterSpacing: "0.06em",
        textTransform: "uppercase",
        color: "var(--ink-faint)",
      }}
    >
      {isRefreshing
        ? lastChecked
          ? `Loading latest state - last checked ${lastChecked}`
          : "Loading latest state"
        : `Last checked ${lastChecked}`}
    </span>
  );
}

function InlineStatus({ children }: { children: React.ReactNode }) {
  return (
    <div
      role="status"
      style={{
        marginTop: 18,
        borderTop: "1px solid var(--rule)",
        borderBottom: "1px solid var(--rule)",
        padding: "10px 0",
        color: "var(--ink-dim)",
        fontSize: 13,
        lineHeight: 1.45,
      }}
    >
      {children}
    </div>
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

function sourceStatusLabel(status: string, isRefreshing: boolean): string {
  if (isRefreshing) return "Loading latest state";
  return status;
}

function sourceStatusDetail(
  source: unknown,
  isRefreshing: boolean,
  freshness?: unknown,
): string {
  const lastChecked = lastCheckedText(freshness) ?? lastCheckedText(source);
  if (isRefreshing) {
    return lastChecked
      ? `Loading latest state - last checked ${lastChecked}`
      : "Loading latest state";
  }
  if (lastChecked) return `Last checked ${lastChecked}`;
  return detailText(source) ?? "";
}

function lastCheckedText(item: unknown): string | null {
  const timestamp = optionalTimestamp(item);
  if (!timestamp) return null;

  const date = new Date(timestamp);
  if (!Number.isFinite(date.getTime())) return null;

  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function optionalTimestamp(item: unknown): string | null {
  if (!item || typeof item !== "object") return null;
  const record = item as Record<string, unknown>;
  const direct = firstString(
    record.lastCheckedAt,
    record.last_checked_at,
    record.lastChecked,
    record.last_checked,
    record.checkedAt,
    record.checked_at,
    record.updatedAt,
    record.updated_at,
  );
  if (direct) return direct;

  const metadata = record.metadata;
  if (!metadata || typeof metadata !== "object") return null;
  const meta = metadata as Record<string, unknown>;
  return firstString(
    meta.lastCheckedAt,
    meta.last_checked_at,
    meta.lastChecked,
    meta.last_checked,
    meta.checkedAt,
    meta.checked_at,
    meta.updatedAt,
    meta.updated_at,
  );
}

function detailText(item: unknown): string | null {
  if (!item || typeof item !== "object") return null;
  const detail = (item as Record<string, unknown>).detail;
  return typeof detail === "string" ? detail : null;
}

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value;
  }
  return null;
}

async function fetchProfileSegment<T>(
  href: string,
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch(href, {
    cache: "no-store",
    signal,
  });
  const payload = (await response.json().catch(() => null)) as
    | (T & { error?: string })
    | null;
  if (!response.ok || !payload) {
    throw new Error(payload?.error ?? `${href} HTTP ${response.status}`);
  }
  return payload;
}

function fallbackFreshness() {
  const now = new Date().toISOString();
  return {
    generatedAt: now,
    lastChecked: now,
    status: "cached" as const,
  };
}
