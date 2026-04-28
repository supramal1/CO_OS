"use client";

import type { AgentActiveStatus } from "@/lib/agents-active-status";

type ActiveStatus = Extract<AgentActiveStatus, { active: true }>;

export function AgentActivityBadge({
  status,
  compact = false,
}: {
  status: AgentActiveStatus | null | undefined;
  compact?: boolean;
}) {
  if (!status?.active) return null;
  const label = compact ? status.workerLabel : status.label;
  return (
    <>
      <span
        aria-label={status.label}
        title={status.label}
        style={{
          ...badgeStyle,
          ...(compact ? compactBadgeStyle : null),
        }}
      >
        <span aria-hidden="true" className="agent-activity-dot" style={dotStyle} />
        <span style={textStyle}>{label}</span>
      </span>
      <AgentActivityPulseStyle />
    </>
  );
}

export function AgentActivityBanner({
  status,
}: {
  status: AgentActiveStatus | null | undefined;
}) {
  if (!status?.active) return null;
  return (
    <section aria-label={status.label} style={bannerStyle}>
      <div style={bannerHeaderStyle}>
        <span aria-hidden="true" className="agent-activity-dot" style={dotStyle} />
        <strong style={bannerTitleStyle}>{status.workerLabel} working now</strong>
      </div>
      <div style={bannerMetaStyle}>
        {status.runLabel} run | {formatStartedAt(status)}
      </div>
      <AgentActivityPulseStyle />
    </section>
  );
}

function formatStartedAt(status: ActiveStatus): string {
  if (!status.startedAt) return "Start time not recorded";
  const date = new Date(status.startedAt);
  if (Number.isNaN(date.getTime())) return `Started ${status.startedAt}`;
  return `Started ${date.toLocaleString()}`;
}

function AgentActivityPulseStyle() {
  return (
    <style>{`
      @keyframes agent-activity-pulse {
        0%, 100% { opacity: 0.45; transform: scale(0.78); }
        50% { opacity: 1; transform: scale(1); }
      }
      @media (prefers-reduced-motion: reduce) {
        .agent-activity-dot { animation: none !important; }
      }
    `}</style>
  );
}

const badgeStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  minWidth: 0,
  maxWidth: "100%",
  padding: "2px 7px",
  border: "1px solid var(--c-cornerstone)",
  color: "var(--c-cornerstone)",
  background: "var(--panel-2)",
  fontFamily: "var(--font-plex-mono)",
  fontSize: 9,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
};

const compactBadgeStyle: React.CSSProperties = {
  padding: "3px 7px",
  fontSize: 10,
  letterSpacing: 0,
  textTransform: "none",
};

const dotStyle: React.CSSProperties = {
  width: 7,
  height: 7,
  borderRadius: "50%",
  background: "var(--c-cornerstone)",
  flex: "0 0 auto",
  animation: "agent-activity-pulse 1.15s ease-in-out infinite",
};

const textStyle: React.CSSProperties = {
  minWidth: 0,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

const bannerStyle: React.CSSProperties = {
  margin: "0 24px",
  padding: "12px 14px",
  border: "1px solid var(--c-cornerstone)",
  background: "var(--panel-2)",
};

const bannerHeaderStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
};

const bannerTitleStyle: React.CSSProperties = {
  fontFamily: "var(--font-plex-sans)",
  fontSize: 14,
  fontWeight: 500,
  color: "var(--ink)",
};

const bannerMetaStyle: React.CSSProperties = {
  marginTop: 6,
  fontFamily: "var(--font-plex-mono)",
  fontSize: 10,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  color: "var(--ink-dim)",
};
