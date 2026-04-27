"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type {
  PublicEventLogEntry,
  TaskDetail,
  TaskSummary,
} from "@/lib/workforce/types";
import { runningCostUsdFromEvents } from "@/lib/workforce/cost-observability";
import { StateChip } from "./state-chip";
import { TaskCostMeter } from "./cost-observability";

interface Props {
  taskId: string;
  // Reply re-uses the same dispatcher the compose form goes through.
  // The pane synthesises `context` from the prior turn so the substrate
  // can prepend it to the user message in claude-agent.ts.
  onReply: (input: {
    agentId: string;
    description: string;
    targetWorkspace?: string;
    context: string;
  }) => Promise<{ taskId: string }>;
  onTaskTransition?: (newSummary: TaskDetail) => void;
}

export function TaskConversationPane({ taskId, onReply, onTaskTransition }: Props) {
  const [detail, setDetail] = useState<TaskDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [liveEvents, setLiveEvents] = useState<PublicEventLogEntry[]>([]);
  const [streamState, setStreamState] = useState<"connecting" | "live" | "closed">("connecting");
  const [replyText, setReplyText] = useState("");
  const [sendingReply, setSendingReply] = useState(false);
  const [replyError, setReplyError] = useState<string | null>(null);
  const onTransitionRef = useRef(onTaskTransition);
  const detailRef = useRef<TaskDetail | null>(null);
  onTransitionRef.current = onTaskTransition;

  useEffect(() => {
    detailRef.current = detail;
  }, [detail]);

  // Reset transient state when the user switches tasks. Without this,
  // an in-flight reply textarea on task A would leak into task B.
  useEffect(() => {
    setDetail(null);
    setError(null);
    setLoading(true);
    setLiveEvents([]);
    setReplyText("");
    setReplyError(null);
    setStreamState("connecting");
  }, [taskId]);

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
          onTransitionRef.current?.(body);
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
    let closed = false;
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
      if (closed) return;
      setStreamState("closed");
      es.close();
      void fetch(`/api/workforce/tasks/${taskId}`, { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .then((b: TaskDetail | null) => {
          if (b && !closed) {
            setDetail(b);
            onTransitionRef.current?.(b);
          }
        });
    });
    es.onerror = () => {
      if (closed) return;
      setStreamState("closed");
      es.close();
    };
    return () => {
      closed = true;
      es.close();
    };
  }, [taskId]);

  async function handleCancel() {
    const res = await fetch(`/api/workforce/tasks/${taskId}/cancel`, { method: "POST" });
    if (!res.ok) {
      setError(`Cancel failed: HTTP ${res.status}`);
      return;
    }
    const latest = detailRef.current;
    if (latest?.state === "running") {
      const cancelled: TaskDetail = {
        ...latest,
        state: "cancelled",
        completedAt: new Date().toISOString(),
      };
      setDetail(cancelled);
      onTransitionRef.current?.(cancelled);
    }
  }

  async function handleSendReply(e: React.FormEvent) {
    e.preventDefault();
    if (!detail || !replyText.trim() || sendingReply) return;
    setSendingReply(true);
    setReplyError(null);
    try {
      const context = synthesiseReplyContext(detail);
      await onReply({
        agentId: detail.agentId,
        description: replyText.trim(),
        context,
      });
      setReplyText("");
    } catch (err) {
      setReplyError(err instanceof Error ? err.message : String(err));
    } finally {
      setSendingReply(false);
    }
  }

  if (loading) return <PaneNote>Loading task…</PaneNote>;
  if (error) return <PaneNote tone="error">Failed: {error}</PaneNote>;
  if (!detail) return <PaneNote>Task not found.</PaneNote>;

  const replyDisabled =
    detail.state === "running" ||
    detail.state === "queued" ||
    detail.state === "blocked";
  const liveCostUsd =
    detail.state === "running"
      ? Math.max(detail.totalCostUsd, runningCostUsdFromEvents(liveEvents))
      : detail.totalCostUsd;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, minHeight: 0 }}>
      <header style={{ display: "flex", justifyContent: "space-between", gap: 16, alignItems: "flex-start" }}>
        <div style={{ minWidth: 0 }}>
          <h2
            style={{
              margin: 0,
              fontSize: 16,
              fontWeight: 500,
              color: "var(--ink)",
              lineHeight: 1.4,
            }}
          >
            {detail.description}
          </h2>
          <div
            style={{
              display: "flex",
              gap: 12,
              marginTop: 6,
              flexWrap: "wrap",
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
            <TaskCostMeter
              currentUsd={liveCostUsd}
              maxUsd={detail.maxCostUsd}
              compact
            />
            <span>·</span>
            <span>dur {fmtDuration(detail.durationMs)}</span>
            <span>·</span>
            <span>stream {streamState}</span>
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexShrink: 0 }}>
          <StateChip state={detail.state} />
          {detail.state === "running" ? (
            <button onClick={handleCancel} style={cancelButtonStyle}>
              Cancel
            </button>
          ) : null}
        </div>
      </header>

      {detail.error ? <ErrorPanel error={detail.error} /> : null}

      <section
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1.4fr)",
          gap: 16,
          minHeight: 0,
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", minHeight: 0 }}>
          <PaneHeader>Event log</PaneHeader>
          <EventLogList events={liveEvents} childTasks={detail.children} />
        </div>
        <div style={{ display: "flex", flexDirection: "column", minHeight: 0 }}>
          <PaneHeader>Output</PaneHeader>
          <DeliverableView output={detail.output} state={detail.state} />
        </div>
      </section>

      <form
        onSubmit={handleSendReply}
        style={{ display: "flex", flexDirection: "column", gap: 8 }}
      >
        <PaneHeader>
          {replyDisabled ? "Reply (waiting for response…)" : `Reply to ${detail.agentId}`}
        </PaneHeader>
        <textarea
          value={replyText}
          onChange={(e) => setReplyText(e.target.value)}
          rows={3}
          disabled={replyDisabled}
          placeholder={
            replyDisabled
              ? "You can reply once the agent has responded."
              : "Reply to this thread — answers Ada's clarifying questions, or asks a follow-up."
          }
          style={{
            ...textareaStyle,
            opacity: replyDisabled ? 0.6 : 1,
          }}
          onKeyDown={(e) => {
            // Cmd/Ctrl+Enter sends, matching most chat-style UIs.
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
              void handleSendReply(e as unknown as React.FormEvent);
            }
          }}
        />
        {replyError ? (
          <p style={{ margin: 0, fontSize: 12, color: "var(--c-forge)" }}>{replyError}</p>
        ) : null}
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <button
            type="submit"
            disabled={replyDisabled || sendingReply || !replyText.trim()}
            style={primaryButtonStyle(replyDisabled || sendingReply || !replyText.trim())}
          >
            {sendingReply ? "Sending…" : "Send reply"}
          </button>
          <span
            style={{
              fontFamily: "var(--font-plex-mono)",
              fontSize: 10,
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              color: "var(--ink-faint)",
            }}
          >
            ⌘↩ to send · prior turn is threaded as context
          </span>
        </div>
      </form>
    </div>
  );
}

// Build the substrate `context` payload for a reply turn. The substrate
// prepends this verbatim to the user message (claude-agent.ts:491), so
// the agent reads it as "here's where we are in the conversation"
// before the new instruction lands. We keep it human-readable and
// trim hard so a long Ada response doesn't blow the prompt.
function synthesiseReplyContext(prior: TaskDetail): string {
  const priorOutput = prior.output?.trim() ?? "";
  // Hard cap: 4000 chars is plenty for a clarifying-question turn,
  // and well under model token limits even with overhead.
  const clipped =
    priorOutput.length > 4000
      ? `${priorOutput.slice(0, 4000)}\n\n[…truncated for context…]`
      : priorOutput;
  return [
    "This is a follow-up turn in an ongoing conversation.",
    "",
    "Original request from the user:",
    prior.description,
    "",
    `Your previous response (as ${prior.agentId}):`,
    clipped || "[no output captured]",
    "",
    "The user's reply follows below.",
  ].join("\n");
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
        gap: 0,
        maxHeight: 320,
        overflowY: "auto",
        background: "var(--panel)",
        border: "1px solid var(--rule)",
      }}
    >
      {events.map((e) => {
        const summary = summariseEvent(e, childMap);
        return (
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
            <span style={{ color: "var(--ink-faint)", flexShrink: 0, width: 70 }}>
              {fmtTimeShort(e.timestamp)}
            </span>
            <span
              style={{
                color: typeColor(e.type),
                flexShrink: 0,
                width: 130,
                letterSpacing: "0.08em",
              }}
            >
              {e.type}
            </span>
            <span style={{ color: "var(--ink)", overflow: "hidden", textOverflow: "ellipsis" }}>
              {summary}
            </span>
          </li>
        );
      })}
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
        maxHeight: 320,
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
    <h3
      style={{
        margin: 0,
        marginBottom: 8,
        fontFamily: "var(--font-plex-mono)",
        fontSize: 11,
        letterSpacing: "0.18em",
        textTransform: "uppercase",
        color: "var(--ink-dim)",
      }}
    >
      {children}
    </h3>
  );
}

function PaneNote({
  children,
  tone = "default",
}: {
  children: React.ReactNode;
  tone?: "default" | "error";
}) {
  return (
    <p style={{ margin: 0, fontSize: 14, color: tone === "error" ? "var(--c-forge)" : "var(--ink-dim)" }}>
      {children}
    </p>
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
      return `cost $${Number(p.totalCostUsd ?? p.costUsd ?? 0).toFixed(4)} · ${fmtDuration(Number(p.durationMs ?? 0))}`;
    case "task_failed":
    case "task_cancelled":
      return String(p.errorCode ?? p.message ?? p.error ?? e.type);
    case "model_turn":
      return `turn ${p.turn ?? "?"} · tokens in/out ${p.inputTokens ?? "?"} / ${p.outputTokens ?? "?"} · stop ${p.stopReason ?? "?"}`;
    case "tool_called":
      return String(p.toolName ?? "");
    case "tool_returned": {
      const status = p.status ?? "ok";
      const name = p.toolName ?? "";
      const errCode = p.errorCode ? ` (${p.errorCode})` : "";
      return `${name} → ${status}${errCode}`;
    }
    case "delegate_initiated": {
      const target = p.assignee ?? "?";
      const child = childMap.get(String(p.childTaskId ?? ""));
      return `→ ${target}${child ? ` (${child.state})` : ""}`;
    }
    case "delegate_completed":
      return `${p.assignee ?? "?"} ← ${p.status ?? "?"}${p.errorCode ? ` (${p.errorCode})` : ""}`;
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
  cursor: "pointer",
};

const textareaStyle: React.CSSProperties = {
  padding: 12,
  background: "var(--panel)",
  border: "1px solid var(--rule)",
  color: "var(--ink)",
  fontSize: 14,
  lineHeight: 1.55,
  fontFamily: "var(--font-plex-sans)",
  resize: "vertical",
  minHeight: 70,
};

function primaryButtonStyle(disabled: boolean): React.CSSProperties {
  return {
    padding: "10px 18px",
    background: disabled ? "var(--rule)" : "var(--ink)",
    color: disabled ? "var(--ink-dim)" : "var(--panel)",
    border: "1px solid var(--ink)",
    fontFamily: "var(--font-plex-mono)",
    fontSize: 11,
    letterSpacing: "0.14em",
    textTransform: "uppercase",
    cursor: disabled ? "not-allowed" : "pointer",
  };
}
