"use client";

import type { TaskSummary } from "@/lib/workforce/types";
import { StateChip } from "./state-chip";

interface Props {
  tasks: TaskSummary[];
  selectedTaskId: string | null;
  onSelect: (taskId: string) => void;
}

export function RecentTasksList({ tasks, selectedTaskId, onSelect }: Props) {
  if (tasks.length === 0) {
    return (
      <p style={{ margin: 0, fontSize: 13, color: "var(--ink-dim)" }}>
        No tasks yet. Dispatch one to see it here.
      </p>
    );
  }
  return (
    <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 8 }}>
      {tasks.map((t) => {
        const selected = t.taskId === selectedTaskId;
        return (
          <li key={t.taskId}>
            <button
              type="button"
              onClick={() => onSelect(t.taskId)}
              style={{
                display: "block",
                width: "100%",
                textAlign: "left",
                padding: 12,
                background: selected ? "var(--ink)" : "var(--panel)",
                color: selected ? "var(--panel)" : "var(--ink)",
                border: `1px solid ${selected ? "var(--ink)" : "var(--rule)"}`,
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
                    color: selected ? "var(--panel)" : "var(--ink-dim)",
                    opacity: selected ? 0.75 : 1,
                  }}
                >
                  {t.agentId} · {fmtTime(t.startedAt)}
                </span>
                <StateChip state={t.state} />
              </header>
              <p
                style={{
                  margin: 0,
                  fontSize: 13,
                  color: "inherit",
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
                  color: selected ? "var(--panel)" : "var(--ink-faint)",
                  opacity: selected ? 0.7 : 1,
                  letterSpacing: "0.08em",
                }}
              >
                <span>cost ${t.totalCostUsd.toFixed(4)}</span>
                <span>dur {fmtDuration(t.durationMs)}</span>
              </footer>
            </button>
          </li>
        );
      })}
    </ul>
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
