"use client";

// Per-agent panel. Anchored to a sprite click in the pixel office.
// Shows: who the agent is, what they're doing right now, and a list of
// their recent tasks (both as lead and sub-task). Selecting a task here
// hands control back up to the shell so the convo pane takes over.
//
// Deliberately read-only: the dispatch affordance lives in the compose
// pane, and click-to-message lands in a later phase (needs Paperclip
// backend support). For now this is a "who's that?" + "what have they
// done lately?" surface that pays for the click cost.

import type { PublicAgent, TaskSummary } from "@/lib/workforce/types";
import type { AgentState } from "./office/types";
import { StateChip } from "./state-chip";

interface Props {
  agent: PublicAgent;
  agentState: AgentState | undefined;
  tasks: TaskSummary[];
  onSelectTask: (taskId: string) => void;
  onClose: () => void;
  onComposeForAgent: (agentId: string) => void;
}

export function AgentPanel({
  agent,
  agentState,
  tasks,
  onSelectTask,
  onClose,
  onComposeForAgent,
}: Props) {
  const tasksForAgent = tasks
    .filter((t) => t.agentId === agent.id)
    .sort(
      (a, b) =>
        new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime(),
    );
  const running = tasksForAgent.find((t) => t.state === "running");

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <header
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          gap: 16,
        }}
      >
        <div style={{ minWidth: 0 }}>
          <h2
            style={{
              margin: 0,
              fontFamily: "var(--font-plex-serif)",
              fontWeight: 400,
              fontSize: 28,
              letterSpacing: "-0.01em",
              color: "var(--ink)",
            }}
          >
            {agent.name}
          </h2>
          <p
            style={{
              margin: "4px 0 0",
              fontFamily: "var(--font-plex-mono)",
              fontSize: 11,
              letterSpacing: "0.14em",
              textTransform: "uppercase",
              color: "var(--ink-dim)",
            }}
          >
            {agent.role}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close agent panel"
          style={{
            background: "transparent",
            border: "1px solid var(--rule)",
            color: "var(--ink-dim)",
            padding: "6px 10px",
            fontFamily: "var(--font-plex-mono)",
            fontSize: 10,
            letterSpacing: "0.18em",
            textTransform: "uppercase",
            cursor: "pointer",
          }}
        >
          Close
        </button>
      </header>

      <NowDoing running={running} agentState={agentState} />

      <Stat
        label="Model"
        value={agent.model}
      />
      <Stat
        label="Default workspace"
        value={agent.defaultWorkspace}
      />
      <Stat
        label="Capabilities"
        value={[
          agent.canDelegate ? "delegate" : null,
          agent.canUseCornerstoneRead ? "memory.read" : null,
          agent.canUseCornerstoneWrite ? "memory.write" : null,
        ]
          .filter(Boolean)
          .join(" · ") || "—"}
      />

      {agent.canDelegate && (
        <button
          type="button"
          onClick={() => onComposeForAgent(agent.id)}
          style={{
            padding: "10px 14px",
            background: "transparent",
            color: "var(--ink)",
            border: "1px solid var(--ink)",
            fontFamily: "var(--font-plex-mono)",
            fontSize: 11,
            letterSpacing: "0.14em",
            textTransform: "uppercase",
            cursor: "pointer",
            textAlign: "left",
          }}
        >
          + Dispatch to {agent.name}
        </button>
      )}

      <section style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <SectionHeader>Recent tasks</SectionHeader>
        {tasksForAgent.length === 0 ? (
          <Note>No tasks dispatched to {agent.name} yet.</Note>
        ) : (
          <ul
            style={{
              listStyle: "none",
              margin: 0,
              padding: 0,
              display: "flex",
              flexDirection: "column",
              gap: 8,
            }}
          >
            {tasksForAgent.map((t) => (
              <li key={t.taskId}>
                <button
                  type="button"
                  onClick={() => onSelectTask(t.taskId)}
                  style={{
                    display: "block",
                    width: "100%",
                    textAlign: "left",
                    padding: 12,
                    background: "var(--panel)",
                    color: "var(--ink)",
                    border: "1px solid var(--rule)",
                    cursor: "pointer",
                    fontFamily: "inherit",
                  }}
                >
                  <header
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      marginBottom: 6,
                      gap: 12,
                    }}
                  >
                    <span
                      style={{
                        fontFamily: "var(--font-plex-mono)",
                        fontSize: 10,
                        letterSpacing: "0.14em",
                        textTransform: "uppercase",
                        color: "var(--ink-dim)",
                      }}
                    >
                      {t.parentTaskId ? "sub · " : ""}
                      {fmtTime(t.startedAt)}
                    </span>
                    <StateChip state={t.state} />
                  </header>
                  <p
                    style={{
                      margin: 0,
                      fontSize: 13,
                      display: "-webkit-box",
                      WebkitLineClamp: 2,
                      WebkitBoxOrient: "vertical",
                      overflow: "hidden",
                    }}
                  >
                    {t.description}
                  </p>
                  <footer
                    style={{
                      marginTop: 8,
                      display: "flex",
                      gap: 12,
                      fontFamily: "var(--font-plex-mono)",
                      fontSize: 10,
                      color: "var(--ink-faint)",
                      letterSpacing: "0.08em",
                    }}
                  >
                    <span>cost ${t.costUsd.toFixed(4)}</span>
                    <span>dur {fmtDuration(t.durationMs)}</span>
                  </footer>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

// "Now doing" surface — the live answer to "what is this agent up to?"
// Mirrors the pixel-office speech bubble in plain text so the panel
// reads as the long-form version of the bubble. When the agent is idle,
// this collapses to a quiet "idle" line so the section never disappears
// (which would feel like the panel was broken).
function NowDoing({
  running,
  agentState,
}: {
  running: TaskSummary | undefined;
  agentState: AgentState | undefined;
}) {
  let line: string;
  if (running) {
    const tool = running.currentTool;
    line = tool ? `firing ${tool.name}` : "thinking…";
  } else if (agentState?.kind === "complete") {
    line = "just finished a task";
  } else if (agentState?.kind === "waiting") {
    line = "waiting on a delegate";
  } else if (agentState?.kind === "at_station") {
    line = `at ${agentState.stationId}`;
  } else if (agentState?.kind === "working") {
    line = "working";
  } else {
    line = "idle";
  }
  return (
    <div
      style={{
        padding: "10px 12px",
        border: "1px solid var(--rule)",
        background: "var(--panel-2, rgba(255,255,255,0.03))",
      }}
    >
      <p
        style={{
          margin: 0,
          fontFamily: "var(--font-plex-mono)",
          fontSize: 9,
          letterSpacing: "0.18em",
          textTransform: "uppercase",
          color: "var(--ink-faint)",
          marginBottom: 4,
        }}
      >
        Now
      </p>
      <p style={{ margin: 0, fontSize: 13, color: "var(--ink)" }}>{line}</p>
      {running ? (
        <p
          style={{
            margin: "6px 0 0",
            fontSize: 12,
            color: "var(--ink-dim)",
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
          }}
        >
          {running.description}
        </p>
      ) : null}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 16 }}>
      <span
        style={{
          fontFamily: "var(--font-plex-mono)",
          fontSize: 10,
          letterSpacing: "0.18em",
          textTransform: "uppercase",
          color: "var(--ink-faint)",
        }}
      >
        {label}
      </span>
      <span
        style={{
          fontFamily: "var(--font-plex-mono)",
          fontSize: 11,
          color: "var(--ink-dim)",
          textAlign: "right",
          minWidth: 0,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {value}
      </span>
    </div>
  );
}

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <h3
      style={{
        margin: 0,
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

function Note({ children }: { children: React.ReactNode }) {
  return (
    <p style={{ margin: 0, fontSize: 13, color: "var(--ink-dim)" }}>
      {children}
    </p>
  );
}

function fmtTime(iso: string): string {
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
