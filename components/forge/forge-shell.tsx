"use client";

import { useEffect, useMemo, useState } from "react";
import { useSession } from "next-auth/react";
import type { Brief, BriefStats, BriefStatus } from "@/lib/forge-types";
import { BRIEF_STATUSES, STATUS_LABEL } from "@/lib/forge-types";
import { BriefCard } from "./brief-card";
import { BriefDetail } from "./brief-detail";

type BriefsState =
  | { status: "loading" }
  | { status: "loaded"; briefs: Brief[] }
  | { status: "error"; message: string };

type StatusFilter = BriefStatus | "all";

export function ForgeShell() {
  const { data: session } = useSession();
  const isAdmin = session?.isAdmin ?? false;

  const [briefsState, setBriefsState] = useState<BriefsState>({
    status: "loading",
  });
  const [stats, setStats] = useState<BriefStats | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [filter, setFilter] = useState<StatusFilter>("all");
  const [toast, setToast] = useState<{ kind: "error"; message: string } | null>(
    null,
  );

  const loadBriefs = async () => {
    try {
      const res = await fetch("/api/forge/briefs", { cache: "no-store" });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? `status ${res.status}`);
      }
      const briefs = (await res.json()) as Brief[];
      setBriefsState({ status: "loaded", briefs });
    } catch (err) {
      setBriefsState({
        status: "error",
        message: err instanceof Error ? err.message : "failed to load",
      });
    }
  };

  const loadStats = async () => {
    try {
      const res = await fetch("/api/forge/briefs/stats", { cache: "no-store" });
      if (!res.ok) return;
      setStats((await res.json()) as BriefStats);
    } catch {
      /* non-fatal */
    }
  };

  useEffect(() => {
    loadBriefs();
    loadStats();
  }, []);

  const filtered = useMemo(() => {
    if (briefsState.status !== "loaded") return [];
    if (filter === "all") return briefsState.briefs;
    return briefsState.briefs.filter((b) => b.status === filter);
  }, [briefsState, filter]);

  const activeBrief = useMemo(() => {
    if (briefsState.status !== "loaded") return null;
    return briefsState.briefs.find((b) => b.id === activeId) ?? null;
  }, [briefsState, activeId]);

  const handleBriefUpdated = (next: Brief) => {
    setBriefsState((state) => {
      if (state.status !== "loaded") return state;
      return {
        status: "loaded",
        briefs: state.briefs.map((b) => (b.id === next.id ? next : b)),
      };
    });
    loadStats();
  };

  return (
    <div
      style={{
        height: "calc(100vh - var(--shell-h))",
        display: "grid",
        gridTemplateColumns: "minmax(0, 1fr) 420px",
        minHeight: 0,
      }}
    >
      <section
        style={{
          display: "flex",
          flexDirection: "column",
          borderRight: "1px solid var(--rule)",
          minHeight: 0,
        }}
      >
        <header
          style={{
            padding: "20px 28px 16px",
            borderBottom: "1px solid var(--rule)",
            display: "flex",
            alignItems: "center",
            gap: 12,
            flexWrap: "wrap",
          }}
        >
          <div
            style={{
              fontFamily: "var(--font-plex-mono)",
              fontSize: 10,
              letterSpacing: "0.18em",
              textTransform: "uppercase",
              color: "var(--ink-faint)",
            }}
          >
            Forge briefs
          </div>
          <div style={{ flex: 1 }} />
          <FilterGroup filter={filter} onChange={setFilter} stats={stats} />
        </header>

        <div
          style={{
            flex: 1,
            overflow: "auto",
            padding: "16px 20px",
            display: "flex",
            flexDirection: "column",
            gap: 10,
          }}
        >
          {briefsState.status === "loading" ? (
            <Empty>Loading briefs…</Empty>
          ) : briefsState.status === "error" ? (
            <Empty>Couldn&rsquo;t load — {briefsState.message}</Empty>
          ) : filtered.length === 0 ? (
            <Empty>
              {filter === "all"
                ? "No briefs yet. Ask Charlie to capture one."
                : `No briefs in ${STATUS_LABEL[filter]}.`}
            </Empty>
          ) : (
            filtered.map((brief) => (
              <BriefCard
                key={brief.id}
                brief={brief}
                active={brief.id === activeId}
                onSelect={() => setActiveId(brief.id)}
              />
            ))
          )}
        </div>
      </section>

      <aside
        style={{
          display: "flex",
          flexDirection: "column",
          minHeight: 0,
          background: "var(--panel)",
        }}
      >
        {activeBrief ? (
          <BriefDetail
            brief={activeBrief}
            isAdmin={isAdmin}
            onUpdated={handleBriefUpdated}
            onError={(message) => setToast({ kind: "error", message })}
          />
        ) : (
          <StatsPanel stats={stats} />
        )}
      </aside>

      {toast ? (
        <div
          role="alert"
          style={{
            position: "fixed",
            right: 24,
            bottom: 24,
            padding: "10px 14px",
            background: "var(--ink)",
            color: "var(--panel)",
            fontFamily: "var(--font-plex-sans)",
            fontSize: 13,
            zIndex: 10,
          }}
          onClick={() => setToast(null)}
        >
          {toast.message}
        </div>
      ) : null}
    </div>
  );
}

function FilterGroup({
  filter,
  onChange,
  stats,
}: {
  filter: StatusFilter;
  onChange: (next: StatusFilter) => void;
  stats: BriefStats | null;
}) {
  const options: StatusFilter[] = ["all", ...BRIEF_STATUSES];
  return (
    <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
      {options.map((opt) => {
        const active = filter === opt;
        const count =
          opt === "all" ? stats?.total : stats?.by_status?.[opt as BriefStatus];
        return (
          <button
            key={opt}
            type="button"
            onClick={() => onChange(opt)}
            style={{
              fontFamily: "var(--font-plex-mono)",
              fontSize: 10,
              letterSpacing: "0.1em",
              textTransform: "uppercase",
              padding: "5px 9px",
              background: active ? "var(--ink)" : "transparent",
              color: active ? "var(--panel)" : "var(--ink-dim)",
              border: "1px solid var(--rule)",
              cursor: active ? "default" : "pointer",
            }}
          >
            {opt === "all" ? "All" : STATUS_LABEL[opt]}
            {count != null ? ` ${count}` : ""}
          </button>
        );
      })}
    </div>
  );
}

function StatsPanel({ stats }: { stats: BriefStats | null }) {
  return (
    <div
      style={{
        padding: "28px",
        display: "flex",
        flexDirection: "column",
        gap: 16,
      }}
    >
      <div
        style={{
          fontFamily: "var(--font-plex-mono)",
          fontSize: 10,
          letterSpacing: "0.18em",
          textTransform: "uppercase",
          color: "var(--ink-faint)",
        }}
      >
        Overview
      </div>
      <div
        style={{
          fontFamily: "var(--font-plex-serif)",
          fontSize: 42,
          fontWeight: 400,
          color: "var(--ink)",
          lineHeight: 1,
        }}
      >
        {stats?.total ?? "—"}
      </div>
      <div
        style={{
          fontFamily: "var(--font-plex-sans)",
          fontSize: 13,
          color: "var(--ink-dim)",
        }}
      >
        Total briefs
      </div>

      <div
        style={{
          marginTop: 12,
          display: "grid",
          gridTemplateColumns: "1fr auto",
          gap: "8px 12px",
          borderTop: "1px solid var(--rule)",
          paddingTop: 16,
        }}
      >
        {BRIEF_STATUSES.map((s) => (
          <StatRow
            key={s}
            label={STATUS_LABEL[s]}
            value={stats?.by_status?.[s] ?? 0}
          />
        ))}
      </div>

      <p
        style={{
          marginTop: 16,
          fontFamily: "var(--font-plex-sans)",
          fontSize: 13,
          color: "var(--ink-dim)",
          lineHeight: 1.5,
        }}
      >
        Select a brief to see details or triage it.
      </p>
    </div>
  );
}

function StatRow({ label, value }: { label: string; value: number }) {
  return (
    <>
      <span
        style={{
          fontFamily: "var(--font-plex-sans)",
          fontSize: 13,
          color: "var(--ink-dim)",
        }}
      >
        {label}
      </span>
      <span
        style={{
          fontFamily: "var(--font-plex-mono)",
          fontSize: 13,
          color: "var(--ink)",
        }}
      >
        {value}
      </span>
    </>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        padding: "40px 20px",
        textAlign: "center",
        fontFamily: "var(--font-plex-sans)",
        fontSize: 14,
        color: "var(--ink-dim)",
      }}
    >
      {children}
    </div>
  );
}
