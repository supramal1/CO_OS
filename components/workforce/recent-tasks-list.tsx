"use client";

import Link from "next/link";
import type { TaskSummary } from "@/lib/workforce/types";
import { StateChip } from "./state-chip";

export function RecentTasksList({ tasks }: { tasks: TaskSummary[] }) {
  if (tasks.length === 0) {
    return (
      <p style={{ margin: 0, fontSize: 13, color: "var(--ink-dim)" }}>
        No tasks yet. Dispatch one to see it here.
      </p>
    );
  }
  return (
    <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 8 }}>
      {tasks.map((t) => (
        <li key={t.taskId}>
          <Link href={`/workforce/tasks/${t.taskId}`} style={{ display: "block" }}>
            <article
              style={{
                padding: 12,
                background: "var(--panel)",
                border: "1px solid var(--rule)",
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
                  {t.agentId} · {fmtTime(t.startedAt)}
                </span>
                <StateChip state={t.state} />
              </header>
              <p
                style={{
                  margin: 0,
                  fontSize: 13,
                  color: "var(--ink)",
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
            </article>
          </Link>
        </li>
      ))}
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
