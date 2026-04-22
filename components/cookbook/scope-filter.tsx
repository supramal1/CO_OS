"use client";

import type { ScopeGroup, ScopeType } from "@/lib/cookbook-types";

export type ScopeSelection =
  | { kind: "all" }
  | { kind: "scope"; scopeType: ScopeType; scopeId: string | null };

export function ScopeFilter({
  groups,
  selection,
  onSelect,
  totalCount,
}: {
  groups: ScopeGroup[];
  selection: ScopeSelection;
  onSelect: (s: ScopeSelection) => void;
  totalCount: number;
}) {
  const isAll = selection.kind === "all";
  return (
    <aside
      style={{
        borderRight: "1px solid var(--rule)",
        background: "var(--panel)",
        padding: "20px 0",
        overflowY: "auto",
      }}
    >
      <button
        type="button"
        onClick={() => onSelect({ kind: "all" })}
        style={rowStyle(isAll)}
      >
        <span>All skills</span>
        <span style={countStyle}>{totalCount}</span>
      </button>

      {groups.map((group) => (
        <div key={group.type} style={{ marginTop: 18 }}>
          <div
            style={{
              padding: "0 16px 6px",
              fontFamily: "var(--font-plex-mono)",
              fontSize: 10,
              letterSpacing: "0.14em",
              textTransform: "uppercase",
              color: "var(--ink-faint)",
            }}
          >
            {group.label}
          </div>
          {group.children.length === 0 && (
            <div
              style={{
                padding: "4px 16px",
                fontFamily: "var(--font-plex-sans)",
                fontSize: 12,
                color: "var(--ink-faint)",
              }}
            >
              —
            </div>
          )}
          {group.children.map((child) => {
            const isActive =
              selection.kind === "scope" &&
              selection.scopeType === group.type &&
              (selection.scopeId ?? "global") === child.id;
            return (
              <button
                key={`${group.type}-${child.id}`}
                type="button"
                onClick={() =>
                  onSelect({
                    kind: "scope",
                    scopeType: group.type,
                    scopeId: group.type === "global" ? null : child.id,
                  })
                }
                style={rowStyle(isActive)}
              >
                <span
                  style={{
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {child.label}
                </span>
                <span style={countStyle}>{child.count}</span>
              </button>
            );
          })}
        </div>
      ))}
    </aside>
  );
}

const countStyle: React.CSSProperties = {
  fontFamily: "var(--font-plex-mono)",
  fontSize: 10,
  color: "var(--ink-faint)",
  letterSpacing: "0.04em",
};

function rowStyle(active: boolean): React.CSSProperties {
  return {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    width: "100%",
    padding: "7px 14px 7px 14px",
    borderLeft: `2px solid ${active ? "var(--c-cookbook)" : "transparent"}`,
    background: active ? "var(--panel-2)" : "transparent",
    color: active ? "var(--ink)" : "var(--ink-dim)",
    fontFamily: "var(--font-plex-sans)",
    fontSize: 12,
    textAlign: "left",
    transition: "color 120ms ease, background 120ms ease",
  };
}
