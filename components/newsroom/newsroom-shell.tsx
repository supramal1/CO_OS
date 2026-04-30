"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  NewsroomAction,
  NewsroomBrief,
  NewsroomConfidence,
  NewsroomItem,
  NewsroomSourceStatus,
} from "@/lib/newsroom/types";
import {
  deriveNewsroomEmptyMessage,
  sourceLabel,
  sourceStatusLabel,
} from "./newsroom-display";

type NewsroomState =
  | { status: "loading" }
  | { status: "loaded"; brief: NewsroomBrief }
  | { status: "error"; message: string };

type NewsroomBriefResponse = {
  brief?: NewsroomBrief;
  error?: string;
};

export function NewsroomShell() {
  const [state, setState] = useState<NewsroomState>({ status: "loading" });
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(() => new Set());

  const loadBrief = useCallback(async () => {
    setState({ status: "loading" });
    try {
      const response = await fetch("/api/newsroom/brief", {
        cache: "no-store",
      });
      const payload = (await response.json()) as NewsroomBriefResponse;
      if (!response.ok || !payload.brief) {
        throw new Error(payload.error ?? "Could not load Newsroom brief.");
      }
      setState({ status: "loaded", brief: payload.brief });
    } catch (error) {
      setState({
        status: "error",
        message:
          error instanceof Error ? error.message : "Could not load Newsroom brief.",
      });
    }
  }, []);

  useEffect(() => {
    void loadBrief();
  }, [loadBrief]);

  const brief = state.status === "loaded" ? state.brief : null;
  const visibleToday = useVisibleItems(brief?.today ?? [], dismissedIds);
  const visibleChanged = useVisibleItems(
    brief?.changedSinceYesterday ?? [],
    dismissedIds,
  );
  const visibleAttention = useVisibleItems(brief?.needsAttention ?? [], dismissedIds);
  const emptyMessage = deriveNewsroomEmptyMessage(brief?.sourceStatuses ?? []);

  return (
    <div
      style={{
        height: "calc(100vh - var(--shell-h))",
        display: "grid",
        gridTemplateColumns: "minmax(0, 1fr) 360px",
        minHeight: 0,
        background: "var(--paper)",
      }}
    >
      <main
        style={{
          display: "flex",
          flexDirection: "column",
          minHeight: 0,
          borderRight: "1px solid var(--rule)",
        }}
      >
        <header
          style={{
            padding: "18px 28px 14px",
            borderBottom: "1px solid var(--rule)",
            display: "flex",
            alignItems: "center",
            gap: 14,
          }}
        >
          <div>
            <MetaLabel>Newsroom</MetaLabel>
            <h1
              style={{
                margin: "6px 0 0",
                fontFamily: "var(--font-plex-serif)",
                fontSize: 30,
                lineHeight: 1.05,
                fontWeight: 400,
                color: "var(--ink)",
              }}
            >
              Daily context brief
            </h1>
          </div>
          <div style={{ flex: 1 }} />
          <button type="button" onClick={loadBrief} style={buttonStyle}>
            Refresh
          </button>
        </header>

        <div
          style={{
            flex: 1,
            minHeight: 0,
            overflow: "auto",
            padding: "18px 20px 24px",
            display: "grid",
            alignContent: "start",
            gap: 18,
          }}
        >
          {state.status === "loading" ? (
            <EmptyLine>Loading Newsroom brief...</EmptyLine>
          ) : state.status === "error" ? (
            <EmptyLine>Could not load Newsroom brief. {state.message}</EmptyLine>
          ) : (
            <>
              <NewsroomSection
                title="Today"
                items={visibleToday}
                emptyMessage={emptyMessage}
                onDismiss={(id) => dismissItem(id, setDismissedIds)}
              />
              <NewsroomSection
                title="Changed Since Yesterday"
                items={visibleChanged}
                emptyMessage={emptyMessage}
                onDismiss={(id) => dismissItem(id, setDismissedIds)}
              />
            </>
          )}
        </div>
      </main>

      <aside
        style={{
          display: "flex",
          flexDirection: "column",
          minHeight: 0,
          background: "var(--panel)",
        }}
      >
        {state.status === "loaded" ? (
          <div
            style={{
              flex: 1,
              minHeight: 0,
              overflow: "auto",
              padding: "20px",
              display: "flex",
              flexDirection: "column",
              gap: 20,
            }}
          >
            <NewsroomSection
              title="Needs Attention"
              items={visibleAttention}
              emptyMessage={emptyMessage}
              onDismiss={(id) => dismissItem(id, setDismissedIds)}
              compact
            />
            <ActionsPanel actions={brief?.suggestedNextActions ?? []} />
            <SourceHealth statuses={brief?.sourceStatuses ?? []} />
          </div>
        ) : (
          <div style={{ padding: 20 }}>
            <MetaLabel>Source health</MetaLabel>
            <EmptyLine>
              {state.status === "error" ? "Unavailable until the brief loads." : "Checking sources..."}
            </EmptyLine>
          </div>
        )}
      </aside>
    </div>
  );
}

function useVisibleItems(items: NewsroomItem[], dismissedIds: Set<string>) {
  return useMemo(
    () => items.filter((item) => !dismissedIds.has(item.id)),
    [dismissedIds, items],
  );
}

function dismissItem(
  id: string,
  setDismissedIds: React.Dispatch<React.SetStateAction<Set<string>>>,
) {
  setDismissedIds((current) => {
    const next = new Set(current);
    next.add(id);
    return next;
  });
}

function NewsroomSection({
  title,
  items,
  emptyMessage,
  onDismiss,
  compact = false,
}: {
  title: string;
  items: NewsroomItem[];
  emptyMessage: string;
  onDismiss: (id: string) => void;
  compact?: boolean;
}) {
  return (
    <section style={{ display: "grid", gap: 8 }}>
      <MetaLabel>{title}</MetaLabel>
      {items.length === 0 ? (
        <EmptyLine>{emptyMessage}</EmptyLine>
      ) : (
        <div style={{ display: "grid", gap: compact ? 8 : 10 }}>
          {items.map((item) => (
            <NewsroomItemRow
              key={item.id}
              item={item}
              onDismiss={() => onDismiss(item.id)}
              compact={compact}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function NewsroomItemRow({
  item,
  onDismiss,
  compact,
}: {
  item: NewsroomItem;
  onDismiss: () => void;
  compact: boolean;
}) {
  return (
    <article
      style={{
        borderTop: "1px solid var(--rule)",
        padding: compact ? "10px 0 0" : "12px 0 0",
        display: "grid",
        gap: 7,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "start",
          gap: 12,
        }}
      >
        <div style={{ minWidth: 0, flex: 1 }}>
          <h2
            style={{
              margin: 0,
              fontFamily: "var(--font-plex-sans)",
              fontSize: compact ? 14 : 15,
              lineHeight: 1.25,
              fontWeight: 500,
              color: "var(--ink)",
            }}
          >
            {item.title}
          </h2>
          <p
            style={{
              margin: "5px 0 0",
              fontFamily: "var(--font-plex-sans)",
              fontSize: 13,
              lineHeight: 1.45,
              color: "var(--ink-dim)",
            }}
          >
            {item.reason}
          </p>
        </div>
        <button type="button" onClick={onDismiss} style={quietButtonStyle}>
          Dismiss
        </button>
      </div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          flexWrap: "wrap",
        }}
      >
        <Provenance source={item.source} confidence={item.confidence} />
        {item.action ? <ActionLink action={item.action} /> : null}
        {!item.action && item.href ? (
          <Link href={item.href} style={linkStyle}>
            Open source
          </Link>
        ) : null}
      </div>
    </article>
  );
}

function Provenance({
  source,
  confidence,
}: {
  source: NewsroomItem["source"];
  confidence: NewsroomConfidence;
}) {
  return (
    <span
      style={{
        fontFamily: "var(--font-plex-mono)",
        fontSize: 10,
        letterSpacing: "0.12em",
        textTransform: "uppercase",
        color: "var(--ink-faint)",
      }}
    >
      {sourceLabel(source)} / {confidence}
    </span>
  );
}

function ActionsPanel({ actions }: { actions: NewsroomAction[] }) {
  return (
    <section style={{ display: "grid", gap: 8 }}>
      <MetaLabel>Suggested Next Actions</MetaLabel>
      {actions.length === 0 ? (
        <EmptyLine>No suggested actions right now.</EmptyLine>
      ) : (
        <div style={{ display: "grid", gap: 8 }}>
          {actions.map((action) => (
            <ActionLink key={`${action.target}:${action.href}`} action={action} />
          ))}
        </div>
      )}
    </section>
  );
}

function SourceHealth({ statuses }: { statuses: NewsroomSourceStatus[] }) {
  return (
    <section style={{ display: "grid", gap: 8 }}>
      <MetaLabel>Source health</MetaLabel>
      {statuses.length === 0 ? (
        <EmptyLine>No source health reported.</EmptyLine>
      ) : (
        <div style={{ display: "grid", gap: 8 }}>
          {statuses.map((status) => (
            <div
              key={status.source}
              style={{
                borderTop: "1px solid var(--rule)",
                paddingTop: 8,
                display: "grid",
                gap: 3,
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  gap: 12,
                  fontFamily: "var(--font-plex-sans)",
                  fontSize: 13,
                  color: "var(--ink)",
                }}
              >
                <span>{sourceStatusLabel(status)}</span>
                <span style={{ fontFamily: "var(--font-plex-mono)" }}>
                  {status.itemsCount}
                </span>
              </div>
              {status.reason ? <EmptyLine>{status.reason}</EmptyLine> : null}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function ActionLink({ action }: { action: NewsroomAction }) {
  return (
    <Link href={action.href} style={linkStyle}>
      {action.label}
    </Link>
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

function EmptyLine({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontFamily: "var(--font-plex-sans)",
        fontSize: 13,
        lineHeight: 1.45,
        color: "var(--ink-dim)",
      }}
    >
      {children}
    </div>
  );
}

const buttonStyle: React.CSSProperties = {
  fontFamily: "var(--font-plex-mono)",
  fontSize: 10,
  letterSpacing: "0.12em",
  textTransform: "uppercase",
  padding: "7px 10px",
  border: "1px solid var(--rule)",
  background: "transparent",
  color: "var(--ink)",
  cursor: "pointer",
};

const quietButtonStyle: React.CSSProperties = {
  ...buttonStyle,
  padding: "5px 8px",
  color: "var(--ink-dim)",
};

const linkStyle: React.CSSProperties = {
  fontFamily: "var(--font-plex-mono)",
  fontSize: 10,
  letterSpacing: "0.12em",
  textTransform: "uppercase",
  color: "var(--ink)",
  textDecoration: "underline",
  textUnderlineOffset: 3,
};
