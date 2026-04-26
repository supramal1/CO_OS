"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type {
  PublicEventLogEntry,
  TaskDetail,
  TaskSummary,
} from "@/lib/workforce/types";
import { StateChip } from "./state-chip";

interface Props {
  taskId: string;
}

export function TaskDetailView({ taskId }: Props) {
  const [detail, setDetail] = useState<TaskDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [liveEvents, setLiveEvents] = useState<PublicEventLogEntry[]>([]);
  const [streamState, setStreamState] = useState<"connecting" | "live" | "closed">("connecting");

  useEffect(() => {
    let cancelled = false;
    async function fetchOnce() {
      try {
        const res = await fetch(`/api/workforce/tasks/${taskId}`, { cache: "no-store" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const body = (await res.json()) as TaskDetail;
        if (!cancelled) {
          setDetail(body);
          setLoading(false);
          setLiveEvents(body.events);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
          setLoading(false);
        }
      }
    }
    void fetchOnce();
    return () => {
      cancelled = true;
    };
  }, [taskId]);

  useEffect(() => {
    if (!detail) return;
    if (detail.state !== "running") {
      setStreamState("closed");
      return;
    }
    const es = new EventSource(`/api/workforce/tasks/${taskId}/events`);
    setStreamState("live");
    es.addEventListener("event", (e) => {
      try {
        const entry = JSON.parse((e as MessageEvent).data) as PublicEventLogEntry;
        setLiveEvents((prev) => {
          if (prev.some((p) => p.seq === entry.seq && p.taskId === entry.taskId)) return prev;
          return [...prev, entry].sort((a, b) =>
            a.timestamp < b.timestamp ? -1 : a.timestamp > b.timestamp ? 1 : a.seq - b.seq,
          );
        });
      } catch {
        // ignore parse errors
      }
    });
    es.addEventListener("end", () => {
      setStreamState("closed");
      es.close();
      // Re-fetch final detail (cost / output / etc).
      void fetch(`/api/workforce/tasks/${taskId}`, { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .then((b: TaskDetail | null) => {
          if (b) setDetail(b);
        });
    });
    es.onerror = () => {
      setStreamState("closed");
      es.close();
    };
    return () => {
      es.close();
    };
  }, [taskId, detail]);

  async function handleCancel() {
    await fetch(`/api/workforce/tasks/${taskId}/cancel`, { method: "POST" });
  }

  if (loading) return <PageNote>Loading task…</PageNote>;
  if (error) return <PageNote tone="error">Failed: {error}</PageNote>;
  if (!detail) return <PageNote>Task not found.</PageNote>;

  return (
    <div style={{ padding: 28, display: "flex", flexDirection: "column", gap: 20 }}>
      <header style={{ display: "flex", justifyContent: "space-between", gap: 24, alignItems: "flex-start" }}>
        <div>
          <Link
            href="/workforce"
            style={{
              fontFamily: "var(--font-plex-mono)",
              fontSize: 10,
              letterSpacing: "0.14em",
              textTransform: "uppercase",
              color: "var(--ink-dim)",
            }}
          >
            ← Workforce dispatch
          </Link>
          <h1
            style={{
              margin: "8px 0 0",
              fontSize: 18,
              fontWeight: 500,
              color: "var(--ink)",
              maxWidth: 720,
            }}
          >
            {detail.description}
          </h1>
          <div
            style={{
              display: "flex",
              gap: 16,
              marginTop: 8,
              fontFamily: "var(--font-plex-mono)",
              fontSize: 10,
              color: "var(--ink-dim)",
              letterSpacing: "0.1em",
            }}
          >
            <span>{detail.agentId}</span>
            <span>·</span>
            <span>{new Date(detail.startedAt).toLocaleString()}</span>
            <span>·</span>
            <span>cost ${detail.costUsd.toFixed(4)}</span>
            <span>·</span>
            <span>dur {fmtDuration(detail.durationMs)}</span>
            <span>·</span>
            <span>stream {streamState}</span>
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <StateChip state={detail.state} />
          {detail.state === "running" ? (
            <button onClick={handleCancel} style={cancelButtonStyle}>
              Cancel
            </button>
          ) : null}
        </div>
      </header>

      {detail.error ? (
        <ErrorPanel error={detail.error} />
      ) : null}

      <section
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0, 2fr) minmax(0, 3fr)",
          gap: 24,
        }}
      >
        <div>
          <PaneHeader>Event log</PaneHeader>
          <EventLogList events={liveEvents} childTasks={detail.children} />
        </div>
        <div>
          <PaneHeader>Final output</PaneHeader>
          <DeliverableView output={detail.output} state={detail.state} />
        </div>
      </section>
    </div>
  );
}

function EventLogList({
  events,
  childTasks,
}: {
  events: PublicEventLogEntry[];
  childTasks: TaskSummary[];
}) {
  const childMap = useMemo(() => {
    const m = new Map<string, TaskSummary>();
    for (const c of childTasks) m.set(c.taskId, c);
    return m;
  }, [childTasks]);

  if (events.length === 0) {
    return <p style={{ margin: 0, fontSize: 12, color: "var(--ink-dim)" }}>No events yet.</p>;
  }

  return (
    <ol
      style={{
        listStyle: "none",
        padding: 0,
        margin: 0,
        display: "flex",
        flexDirection: "column",
        gap: 4,
        maxHeight: "70vh",
        overflowY: "auto",
        background: "var(--panel)",
        border: "1px solid var(--rule)",
      }}
    >
      {events.map((e) => (
        <li
          key={`${e.taskId}:${e.seq}`}
          style={{
            padding: "6px 12px",
            borderBottom: "1px solid var(--rule)",
            fontFamily: "var(--font-plex-mono)",
            fontSize: 11,
            color: "var(--ink-dim)",
            display: "flex",
            gap: 12,
          }}
        >
          <span style={{ color: "var(--ink-faint)", flexShrink: 0, width: 80 }}>
            {fmtTimeShort(e.timestamp)}
          </span>
          <span
            style={{
              color: typeColor(e.type),
              flexShrink: 0,
              width: 140,
              letterSpacing: "0.08em",
            }}
          >
            {e.type}
          </span>
          <span style={{ color: "var(--ink)", overflow: "hidden", textOverflow: "ellipsis" }}>
            {summariseEvent(e, childMap)}
          </span>
        </li>
      ))}
    </ol>
  );
}

function DeliverableView({ output, state }: { output: string; state: string }) {
  if (!output && state === "running") {
    return (
      <p style={{ margin: 0, fontSize: 12, color: "var(--ink-dim)" }}>
        Working… output will land here when the lead returns.
      </p>
    );
  }
  if (!output) {
    return <p style={{ margin: 0, fontSize: 12, color: "var(--ink-dim)" }}>No output.</p>;
  }
  return (
    <article
      style={{
        background: "var(--panel)",
        border: "1px solid var(--rule)",
        padding: 16,
        fontSize: 14,
        lineHeight: 1.6,
        color: "var(--ink)",
        maxHeight: "70vh",
        overflowY: "auto",
      }}
    >
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{output}</ReactMarkdown>
    </article>
  );
}

function ErrorPanel({ error }: { error: { code: string; message: string } }) {
  return (
    <div
      style={{
        background: "var(--panel)",
        border: "1px solid var(--c-forge)",
        padding: 12,
        fontSize: 13,
        color: "var(--ink)",
      }}
    >
      <strong style={{ fontFamily: "var(--font-plex-mono)", fontSize: 11, color: "var(--c-forge)" }}>
        {error.code}
      </strong>
      <p style={{ margin: "4px 0 0" }}>{error.message}</p>
    </div>
  );
}

function PaneHeader({ children }: { children: React.ReactNode }) {
  return (
    <h2
      style={{
        margin: 0,
        marginBottom: 12,
        fontFamily: "var(--font-plex-mono)",
        fontSize: 11,
        letterSpacing: "0.18em",
        textTransform: "uppercase",
        color: "var(--ink-dim)",
      }}
    >
      {children}
    </h2>
  );
}

function PageNote({
  children,
  tone = "default",
}: {
  children: React.ReactNode;
  tone?: "default" | "error";
}) {
  return (
    <div style={{ padding: 28 }}>
      <p style={{ margin: 0, fontSize: 14, color: tone === "error" ? "var(--c-forge)" : "var(--ink-dim)" }}>
        {children}
      </p>
    </div>
  );
}

function fmtTimeShort(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return iso;
  }
}

function fmtDuration(ms: number): string {
  if (!ms) return "—";
  if (ms < 1_000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60_000)}m${Math.floor((ms % 60_000) / 1000)}s`;
}

function typeColor(type: string): string {
  if (type === "task_started" || type === "task_completed") return "var(--c-cornerstone)";
  if (type === "task_failed" || type === "task_cancelled") return "var(--c-forge)";
  if (type === "delegate_initiated" || type === "delegate_completed") return "var(--c-cookbook)";
  return "var(--ink-dim)";
}

function summariseEvent(
  e: PublicEventLogEntry,
  childMap: Map<string, TaskSummary>,
): string {
  const p = e.payload as Record<string, unknown>;
  switch (e.type) {
    case "task_started":
      return String(p.description ?? "");
    case "task_completed":
      return `cost $${Number(p.costUsd ?? 0).toFixed(4)} · ${p.duration_ms ?? p.durationMs ?? "?"}ms`;
    case "task_failed":
      return String(p.message ?? p.error ?? "failed");
    case "model_turn":
      return `tokens in/out ${p.input_tokens ?? "?"} / ${p.output_tokens ?? "?"}`;
    case "tool_called":
      return String(p.name ?? p.tool_name ?? "");
    case "tool_returned": {
      const status = p.status ?? "ok";
      const name = p.name ?? p.tool_name ?? "";
      return `${name} → ${status}`;
    }
    case "delegate_initiated": {
      const target = p.targetAgentId ?? p.target_agent_id ?? "?";
      const child = childMap.get(String(p.childTaskId ?? p.child_task_id ?? ""));
      return `→ ${target}${child ? ` (${child.state})` : ""}`;
    }
    case "delegate_completed":
      return `${p.targetAgentId ?? p.target_agent_id ?? "?"} ← ${p.status ?? "?"}`;
    default:
      return "";
  }
}

const cancelButtonStyle: React.CSSProperties = {
  padding: "6px 12px",
  background: "transparent",
  color: "var(--c-forge)",
  border: "1px solid var(--c-forge)",
  fontFamily: "var(--font-plex-mono)",
  fontSize: 10,
  letterSpacing: "0.14em",
  textTransform: "uppercase",
};
