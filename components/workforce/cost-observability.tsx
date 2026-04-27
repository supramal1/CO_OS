"use client";

import type { TaskSummary } from "@/lib/workforce/types";
import {
  costTelemetryFor,
  workforceCostSummary,
  type CostAlert,
} from "@/lib/workforce/cost-observability";

export function WorkforceCostBand({ tasks }: { tasks: TaskSummary[] }) {
  const roots = tasks.filter((t) => !t.parentTaskId);
  const summary = workforceCostSummary(roots);
  const runningCount = roots.filter((t) => t.state === "running").length;

  return (
    <section
      aria-label="Workforce cost"
      style={{
        gridColumn: "1 / -1",
        border: "1px solid var(--rule)",
        background: "var(--panel)",
        padding: 12,
        display: "grid",
        gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
        gap: 12,
      }}
    >
      <CostMetric label="Running" value={formatUsd(summary.runningUsd)} detail={`${runningCount} active`} />
      <CostMetric label="Recent" value={formatUsd(summary.recentUsd)} detail={`${roots.length} tasks`} />
      <CostMetric label="Capped" value={String(summary.cappedTaskCount)} detail="with budget" />
      <CostMetric
        label="Over cap"
        value={String(summary.overCapCount)}
        detail={`${summary.overrunCount} overrun`}
        alert={summary.overrunCount > 0 ? "overrun" : summary.overCapCount > 0 ? "over_cap" : "none"}
      />
    </section>
  );
}

export function TaskCostMeter({
  currentUsd,
  maxUsd,
  compact = false,
}: {
  currentUsd: number;
  maxUsd?: number;
  compact?: boolean;
}) {
  const telemetry = costTelemetryFor(currentUsd, maxUsd);
  const accent = alertColor(telemetry.alert);
  const pct = Math.min(100, Math.max(0, (telemetry.ratio ?? 0) * 100));

  return (
    <span
      style={{
        display: "inline-flex",
        flexDirection: "column",
        gap: compact ? 4 : 6,
        minWidth: compact ? 96 : 160,
      }}
    >
      <span
        style={{
          display: "inline-flex",
          gap: 6,
          alignItems: "baseline",
          color: accent,
          whiteSpace: "nowrap",
        }}
      >
        <span>cost ${formatCost(telemetry.currentUsd)}</span>
        {telemetry.maxUsd !== undefined ? (
          <span style={{ color: "var(--ink-faint)" }}>
            / ${formatCost(telemetry.maxUsd)}
          </span>
        ) : null}
        {telemetry.alert !== "none" ? (
          <span
            style={{
              fontSize: 9,
              letterSpacing: "0.12em",
              textTransform: "uppercase",
            }}
          >
            {alertLabel(telemetry.alert)}
          </span>
        ) : null}
      </span>
      {telemetry.maxUsd !== undefined ? (
        <span
          aria-hidden="true"
          style={{
            display: "block",
            height: compact ? 3 : 4,
            background: "var(--rule)",
            overflow: "hidden",
          }}
        >
          <span
            style={{
              display: "block",
              height: "100%",
              width: `${pct}%`,
              background: accent,
            }}
          />
        </span>
      ) : null}
    </span>
  );
}

function CostMetric({
  label,
  value,
  detail,
  alert = "none",
}: {
  label: string;
  value: string;
  detail: string;
  alert?: CostAlert;
}) {
  return (
    <div style={{ minWidth: 0 }}>
      <div
        style={{
          fontFamily: "var(--font-plex-mono)",
          fontSize: 9,
          letterSpacing: "0.16em",
          textTransform: "uppercase",
          color: "var(--ink-faint)",
        }}
      >
        {label}
      </div>
      <div
        style={{
          marginTop: 4,
          fontFamily: "var(--font-plex-mono)",
          fontSize: 18,
          color: alertColor(alert),
        }}
      >
        {value}
      </div>
      <div
        style={{
          marginTop: 2,
          fontSize: 11,
          color: "var(--ink-dim)",
        }}
      >
        {detail}
      </div>
    </div>
  );
}

function alertColor(alert: CostAlert): string {
  if (alert === "overrun" || alert === "over_cap") return "var(--c-forge)";
  if (alert === "near_cap") return "var(--c-cookbook)";
  return "var(--ink-dim)";
}

function alertLabel(alert: CostAlert): string {
  if (alert === "near_cap") return "near cap";
  if (alert === "over_cap") return "over cap";
  if (alert === "overrun") return "overrun";
  return "";
}

function formatUsd(value: number): string {
  return `$${formatCost(value)}`;
}

function formatCost(value: number): string {
  if (value >= 100) return value.toFixed(0);
  if (value >= 10) return value.toFixed(2);
  return value.toFixed(4);
}
