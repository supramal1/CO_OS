"use client";

import type { SkillSummary, ScopeType } from "@/lib/cookbook-types";

export function SkillCard({
  skill,
  active,
  onSelect,
}: {
  skill: SkillSummary;
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
        border: `1px solid ${active ? "var(--c-cookbook)" : "var(--rule)"}`,
        color: "var(--ink)",
        transition: "border-color 120ms ease, background 120ms ease",
        cursor: "pointer",
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
        <span style={scopePillStyle(skill.scope_type)}>
          {scopeLabel(skill)}
        </span>
        <span
          style={{
            fontFamily: "var(--font-plex-mono)",
            fontSize: 10,
            color: "var(--ink-faint)",
            letterSpacing: "0.04em",
          }}
        >
          v{skill.version}
        </span>
      </div>
      <h3
        style={{
          margin: 0,
          fontFamily: "var(--font-plex-serif)",
          fontSize: 17,
          fontWeight: 400,
          color: "var(--ink)",
          lineHeight: 1.25,
        }}
      >
        {skill.name}
      </h3>
      <p
        style={{
          margin: "6px 0 0",
          fontFamily: "var(--font-plex-sans)",
          fontSize: 12.5,
          color: "var(--ink-dim)",
          lineHeight: 1.5,
          display: "-webkit-box",
          WebkitLineClamp: 3,
          WebkitBoxOrient: "vertical",
          overflow: "hidden",
        }}
      >
        {skill.description}
      </p>
      <div
        style={{
          marginTop: 12,
          display: "flex",
          flexWrap: "wrap",
          gap: 6,
        }}
      >
        {skill.tags.slice(0, 4).map((t) => (
          <span key={t} style={tagStyle}>
            {t}
          </span>
        ))}
      </div>
    </button>
  );
}

function scopeLabel(s: SkillSummary) {
  if (s.scope_type === "global") return "GLOBAL";
  if (s.scope_type === "team") return `TEAM · ${s.scope_id?.toUpperCase()}`;
  return `CLIENT · ${s.scope_id?.toUpperCase()}`;
}

function scopePillStyle(type: ScopeType): React.CSSProperties {
  const color =
    type === "global"
      ? "var(--c-cookbook)"
      : type === "team"
      ? "var(--ink-dim)"
      : "var(--c-forge)";
  return {
    fontFamily: "var(--font-plex-mono)",
    fontSize: 9,
    letterSpacing: "0.14em",
    color,
    border: `1px solid ${color}`,
    padding: "2px 6px",
    textTransform: "uppercase",
  };
}

const tagStyle: React.CSSProperties = {
  fontFamily: "var(--font-plex-mono)",
  fontSize: 10,
  color: "var(--ink-dim)",
  border: "1px solid var(--rule-2)",
  padding: "2px 6px",
  letterSpacing: "0.04em",
};
