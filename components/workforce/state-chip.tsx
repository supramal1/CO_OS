"use client";

import type { InvocationState } from "@/lib/workforce/types";

const COLORS: Record<InvocationState, { bg: string; fg: string }> = {
  queued: { bg: "var(--rule)", fg: "var(--ink-dim)" },
  running: { bg: "var(--c-cornerstone)", fg: "var(--bg)" },
  completed: { bg: "var(--c-cookbook)", fg: "var(--bg)" },
  failed: { bg: "var(--c-forge)", fg: "var(--bg)" },
  cancelled: { bg: "var(--ink-faint)", fg: "var(--bg)" },
  rejected: { bg: "var(--c-forge)", fg: "var(--bg)" },
  blocked: { bg: "var(--c-forge)", fg: "var(--bg)" },
};

export function StateChip({ state }: { state: InvocationState | string }) {
  const c = COLORS[state as InvocationState] ?? { bg: "var(--rule)", fg: "var(--ink-dim)" };
  return (
    <span
      style={{
        display: "inline-block",
        padding: "2px 8px",
        background: c.bg,
        color: c.fg,
        fontFamily: "var(--font-plex-mono)",
        fontSize: 9,
        letterSpacing: "0.16em",
        textTransform: "uppercase",
      }}
    >
      {state}
    </span>
  );
}
