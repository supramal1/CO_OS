"use client";

import { useState } from "react";

export type Thread = {
  id: string;
  title: string;
  updatedAt: string; // ISO
};

export function ThreadList({
  threads,
  activeId,
  onSelect,
  onNew,
}: {
  threads: Thread[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
}) {
  const [query, setQuery] = useState("");
  const filtered = query
    ? threads.filter((t) => t.title.toLowerCase().includes(query.toLowerCase()))
    : threads;

  return (
    <aside
      style={{
        display: "flex",
        flexDirection: "column",
        borderRight: "1px solid var(--rule)",
        minHeight: 0,
        background: "var(--panel)",
      }}
    >
      <div
        style={{
          padding: "20px 16px 12px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
        }}
      >
        <span
          style={{
            fontFamily: "var(--font-plex-mono)",
            fontSize: 10,
            letterSpacing: "0.14em",
            color: "var(--ink-faint)",
            textTransform: "uppercase",
          }}
        >
          Threads
        </span>
        <button
          type="button"
          onClick={onNew}
          aria-label="New thread"
          style={{
            width: 22,
            height: 22,
            border: "1px solid var(--rule-2)",
            color: "var(--ink-dim)",
            background: "transparent",
            fontFamily: "var(--font-plex-mono)",
            fontSize: 13,
            lineHeight: "20px",
            cursor: "pointer",
          }}
        >
          +
        </button>
      </div>

      <div style={{ padding: "0 16px 12px" }}>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search threads"
          style={{
            width: "100%",
            background: "var(--panel-2)",
            border: "1px solid var(--rule)",
            color: "var(--ink)",
            fontFamily: "var(--font-plex-sans)",
            fontSize: 12,
            padding: "6px 10px",
            outline: "none",
          }}
        />
      </div>

      <nav
        style={{
          flex: 1,
          overflowY: "auto",
          paddingBottom: 20,
        }}
      >
        {filtered.length === 0 && (
          <p
            style={{
              padding: "12px 16px",
              fontFamily: "var(--font-plex-sans)",
              fontSize: 12,
              color: "var(--ink-faint)",
            }}
          >
            No threads yet.
          </p>
        )}
        {filtered.map((t) => {
          const isActive = t.id === activeId;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => onSelect(t.id)}
              style={{
                display: "block",
                width: "100%",
                textAlign: "left",
                padding: "10px 16px 10px 14px",
                borderLeft: `2px solid ${isActive ? "var(--c-cornerstone)" : "transparent"}`,
                background: isActive ? "var(--panel-2)" : "transparent",
                color: isActive ? "var(--ink)" : "var(--ink-dim)",
                fontFamily: "var(--font-plex-sans)",
                fontSize: 13,
                lineHeight: 1.4,
                cursor: "pointer",
                transition: "color 120ms ease, background 120ms ease",
              }}
              onMouseEnter={(e) => {
                if (!isActive) e.currentTarget.style.color = "var(--ink)";
              }}
              onMouseLeave={(e) => {
                if (!isActive) e.currentTarget.style.color = "var(--ink-dim)";
              }}
            >
              <span
                style={{
                  display: "-webkit-box",
                  WebkitLineClamp: 1,
                  WebkitBoxOrient: "vertical",
                  overflow: "hidden",
                }}
              >
                {t.title}
              </span>
              <span
                style={{
                  display: "block",
                  fontFamily: "var(--font-plex-mono)",
                  fontSize: 10,
                  color: "var(--ink-faint)",
                  letterSpacing: "0.04em",
                  marginTop: 3,
                }}
              >
                {formatRelative(t.updatedAt)}
              </span>
            </button>
          );
        })}
      </nav>
    </aside>
  );
}

function formatRelative(iso: string) {
  const d = new Date(iso);
  const diff = Date.now() - d.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d`;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
