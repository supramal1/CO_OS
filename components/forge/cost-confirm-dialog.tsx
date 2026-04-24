"use client";

import { useEffect, useRef } from "react";
import type { ForgeLane } from "@/lib/agents-types";
import { LANE_LABEL } from "@/lib/agents-types";
import type { CostEstimate } from "@/lib/cost-samples";
import type { FxRate } from "@/lib/fx-rate";

type Props = {
  from: ForgeLane;
  to: ForgeLane;
  taskTitle: string;
  estimate: CostEstimate | null;
  estimateError: boolean;
  fxRate: FxRate | null;
  onConfirm: () => void;
  onCancel: () => void;
};

export function CostConfirmDialog({
  from,
  to,
  taskTitle,
  estimate,
  estimateError,
  fxRate,
  onConfirm,
  onCancel,
}: Props) {
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    confirmRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  const hasSamples = estimate && estimate.sampleSize > 0;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="cost-dialog-title"
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0, 0, 0, 0.55)",
        zIndex: 40,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div
        style={{
          width: "min(480px, 100%)",
          background: "var(--panel)",
          border: "1px solid var(--rule)",
          padding: 24,
          fontFamily: "var(--font-plex-sans)",
          color: "var(--ink)",
        }}
      >
        <div
          style={{
            fontFamily: "var(--font-plex-mono)",
            fontSize: 10,
            letterSpacing: "0.16em",
            textTransform: "uppercase",
            color: "var(--ink-dim)",
            marginBottom: 10,
          }}
        >
          {LANE_LABEL[from]} → {LANE_LABEL[to]}
        </div>
        <h2
          id="cost-dialog-title"
          style={{
            margin: "0 0 16px 0",
            fontSize: 18,
            fontWeight: 500,
            lineHeight: 1.35,
          }}
        >
          {taskTitle}
        </h2>

        <CostReadout
          estimate={estimate}
          estimateError={estimateError}
          fxRate={fxRate}
        />

        {hasSamples ? (
          <p
            style={{
              margin: "14px 0 0 0",
              fontSize: 12,
              color: "var(--ink-faint)",
              lineHeight: 1.5,
            }}
          >
            Based on {estimate!.sampleSize} completed{" "}
            {estimate!.sampleSize === 1 ? "task" : "tasks"}. Actual cost varies
            with brief complexity and retry behaviour.
            {fxRate ? (
              <>
                {" "}
                FX rate {fxRate.rate.toFixed(4)} GBP/USD (ECB, {fxRate.date}).
              </>
            ) : null}
          </p>
        ) : null}

        <div
          style={{
            marginTop: 24,
            display: "flex",
            gap: 8,
            justifyContent: "flex-end",
          }}
        >
          <button
            onClick={onCancel}
            style={{
              padding: "8px 14px",
              background: "transparent",
              border: "1px solid var(--rule)",
              color: "var(--ink-dim)",
              fontFamily: "var(--font-plex-mono)",
              fontSize: 11,
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              cursor: "pointer",
            }}
          >
            Cancel
          </button>
          <button
            ref={confirmRef}
            onClick={onConfirm}
            style={{
              padding: "8px 14px",
              background: "var(--ink)",
              border: "1px solid var(--ink)",
              color: "var(--panel)",
              fontFamily: "var(--font-plex-mono)",
              fontSize: 11,
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              cursor: "pointer",
            }}
          >
            Confirm spend
          </button>
        </div>
      </div>
    </div>
  );
}

function CostReadout({
  estimate,
  estimateError,
  fxRate,
}: {
  estimate: CostEstimate | null;
  estimateError: boolean;
  fxRate: FxRate | null;
}) {
  if (estimateError || !estimate) {
    return (
      <p
        style={{
          margin: 0,
          fontSize: 13,
          lineHeight: 1.5,
          color: "var(--ink-dim)",
        }}
      >
        No historical cost data — estimate unavailable. You can still proceed;
        actual spend will be recorded on completion.
      </p>
    );
  }
  if (estimate.sampleSize === 0) {
    return (
      <p
        style={{
          margin: 0,
          fontSize: 13,
          lineHeight: 1.5,
          color: "var(--ink-dim)",
        }}
      >
        No historical cost data for this transition yet. Actual spend will be
        recorded on completion.
      </p>
    );
  }
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "1fr 1fr",
        gap: 12,
        padding: "14px 16px",
        background: "var(--panel-2)",
        border: "1px solid var(--rule)",
      }}
    >
      <CostStat label="Typical (p50)" value={estimate.p50} fxRate={fxRate} />
      <CostStat label="High-end (p90)" value={estimate.p90} fxRate={fxRate} />
    </div>
  );
}

function CostStat({
  label,
  value,
  fxRate,
}: {
  label: string;
  value: number;
  fxRate: FxRate | null;
}) {
  const gbp = fxRate ? value * fxRate.rate : null;
  return (
    <div>
      <div
        style={{
          fontFamily: "var(--font-plex-mono)",
          fontSize: 10,
          letterSpacing: "0.12em",
          textTransform: "uppercase",
          color: "var(--ink-faint)",
          marginBottom: 4,
        }}
      >
        {label}
      </div>
      {gbp !== null ? (
        <>
          <div
            style={{
              fontSize: 22,
              fontWeight: 500,
              fontVariantNumeric: "tabular-nums",
            }}
          >
            £{gbp.toFixed(2)}
          </div>
          <div
            style={{
              fontFamily: "var(--font-plex-mono)",
              fontSize: 11,
              color: "var(--ink-faint)",
              fontVariantNumeric: "tabular-nums",
              marginTop: 2,
            }}
          >
            ${value.toFixed(2)} USD
          </div>
        </>
      ) : (
        <div
          style={{
            fontSize: 22,
            fontWeight: 500,
            fontVariantNumeric: "tabular-nums",
          }}
        >
          ${value.toFixed(2)}
        </div>
      )}
    </div>
  );
}
