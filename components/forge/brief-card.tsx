"use client";

import type { Brief } from "@/lib/forge-types";
import { STATUS_LABEL, URGENCY_LABEL } from "@/lib/forge-types";

const URGENCY_COLOR: Record<string, string> = {
  low: "var(--ink-faint)",
  medium: "var(--ink-dim)",
  high: "var(--c-forge)",
  critical: "#c0392b",
};

export function BriefCard({
  brief,
  active,
  onSelect,
}: {
  brief: Brief;
  active: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      style={{
        display: "block",
        textAlign: "left",
        width: "100%",
        padding: "16px 18px",
        background: active ? "var(--panel-2)" : "var(--panel)",
        border: `1px solid ${active ? "var(--c-forge)" : "var(--rule)"}`,
        color: "var(--ink)",
        cursor: "pointer",
        transition: "border-color 120ms ease, background 120ms ease",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          marginBottom: 8,
        }}
      >
        <span
          style={{
            fontFamily: "var(--font-plex-mono)",
            fontSize: 10,
            letterSpacing: "0.1em",
            textTransform: "uppercase",
            padding: "3px 8px",
            border: "1px solid var(--rule)",
            color: "var(--ink-dim)",
          }}
        >
          {STATUS_LABEL[brief.status]}
        </span>
        {brief.urgency ? (
          <span
            style={{
              fontFamily: "var(--font-plex-mono)",
              fontSize: 10,
              letterSpacing: "0.08em",
              color: URGENCY_COLOR[brief.urgency] ?? "var(--ink-dim)",
            }}
          >
            {URGENCY_LABEL[brief.urgency]}
          </span>
        ) : null}
        <span
          style={{
            marginLeft: "auto",
            fontFamily: "var(--font-plex-mono)",
            fontSize: 10,
            letterSpacing: "0.08em",
            color: "var(--ink-faint)",
          }}
        >
          {brief.namespace}
        </span>
      </div>
      <div
        style={{
          fontFamily: "var(--font-plex-serif)",
          fontSize: 17,
          lineHeight: 1.25,
          color: "var(--ink)",
          marginBottom: 6,
        }}
      >
        {brief.title}
      </div>
      <div
        style={{
          fontFamily: "var(--font-plex-sans)",
          fontSize: 13,
          color: "var(--ink-dim)",
          lineHeight: 1.45,
          display: "-webkit-box",
          WebkitLineClamp: 2,
          WebkitBoxOrient: "vertical",
          overflow: "hidden",
        }}
      >
        {brief.problem_statement}
      </div>
    </button>
  );
}
