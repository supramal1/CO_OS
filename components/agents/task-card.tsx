"use client";

import type { DragEvent } from "react";
import { AgentActivityBadge } from "@/components/agents/agent-activity-badge";
import type { AgentActiveStatus } from "@/lib/agents-active-status";
import type { ForgeTask } from "@/lib/agents-types";
import { STATUS_LABEL } from "@/lib/agents-types";

export function TaskCard({
  task,
  costUsd,
  activityStatus,
  active,
  onSelect,
  onDragStart,
}: {
  task: ForgeTask;
  costUsd: number | null;
  activityStatus?: AgentActiveStatus | null;
  active: boolean;
  onSelect: () => void;
  onDragStart: (e: DragEvent<HTMLDivElement>) => void;
}) {
  return (
    <div
      draggable
      onDragStart={onDragStart}
      onClick={onSelect}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect();
        }
      }}
      style={{
        padding: "12px 14px",
        background: active ? "var(--panel-2)" : "var(--panel)",
        border: `1px solid ${active ? "var(--c-forge)" : "var(--rule)"}`,
        cursor: "grab",
        userSelect: "none",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          marginBottom: 6,
        }}
      >
        <span
          style={{
            fontFamily: "var(--font-plex-mono)",
            fontSize: 9,
            letterSpacing: "0.12em",
            textTransform: "uppercase",
            padding: "2px 6px",
            border: "1px solid var(--rule)",
            color: "var(--ink-dim)",
          }}
        >
          {STATUS_LABEL[task.status]}
        </span>
        {task.priority > 0 ? (
          <span
            style={{
              fontFamily: "var(--font-plex-mono)",
              fontSize: 10,
              color: "var(--ink-faint)",
            }}
          >
            P{task.priority}
          </span>
        ) : null}
      </div>
      <div
        style={{
          fontFamily: "var(--font-plex-sans)",
          fontSize: 14,
          color: "var(--ink)",
          lineHeight: 1.35,
        }}
      >
        {task.title}
      </div>
      {activityStatus?.active ? (
        <div style={{ marginTop: 8, maxWidth: "100%" }}>
          <AgentActivityBadge status={activityStatus} compact />
        </div>
      ) : null}
      {costUsd !== null ? (
        <div
          aria-label="Task cost"
          style={{
            marginTop: 8,
            fontFamily: "var(--font-plex-mono)",
            fontSize: 10,
            color: "var(--ink-faint)",
            fontVariantNumeric: "tabular-nums",
          }}
        >
          ${costUsd.toFixed(2)}
        </div>
      ) : null}
    </div>
  );
}
