"use client";

// Approval modal — opens when the operator clicks the inbox board on
// the back wall. Renders a centered overlay listing every pending
// approval owned by the current principal, with approve / reject
// affordances per item.
//
// Resolution flow:
//   1. Operator clicks Approve or Reject.
//   2. POST /api/workforce/approvals/{id}.
//   3. On success, optimistically remove the row from the local list.
//      The shell's poll will refresh anyway, but removing immediately
//      keeps the UI snappy and prevents a "ghost row" between resolve
//      and next tick.
//   4. If the response is 404, the entry was already resolved (race
//      with another tab); we still drop it from the local list.
//   5. After every resolve, ask the host to refresh so the office
//      layer transitions the sprite out of awaiting_approval.
//
// Design defaults from the spec: centered modal, no timeout, free-form
// reject reason via prompt() — keeps v0 dead simple. Approve happens on
// click without a confirm step (the modal IS the confirm step).

import { useState } from "react";
import type { PendingApprovalDto } from "@/lib/workforce/approvals-client";
import { resolvePendingApproval } from "@/lib/workforce/approvals-client";
import type { PublicAgent } from "@/lib/workforce/types";

interface Props {
  open: boolean;
  approvals: PendingApprovalDto[];
  agents: PublicAgent[];
  onClose: () => void;
  onResolved: () => void;
}

export function ApprovalModal({
  open,
  approvals,
  agents,
  onClose,
  onResolved,
}: Props) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  async function handleResolve(
    approvalId: string,
    approved: boolean,
    reason?: string,
  ) {
    setBusyId(approvalId);
    setError(null);
    try {
      const result = await resolvePendingApproval(approvalId, {
        approved,
        reason,
      });
      if (!result.ok && result.status !== 404) {
        setError(`resolve failed: HTTP ${result.status}`);
      }
      onResolved();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyId(null);
    }
  }

  const nameById = new Map(agents.map((a) => [a.id, a.name]));

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="approval-modal-title"
      onClick={(e) => {
        // Click outside the dialog body closes the modal — but the
        // operator's click on a button shouldn't dismiss it.
        if (e.target === e.currentTarget) onClose();
      }}
      style={overlayStyle}
    >
      <div style={dialogStyle}>
        <header style={headerStyle}>
          <div>
            <h2 id="approval-modal-title" style={titleStyle}>
              Approvals inbox
            </h2>
            <p style={subtitleStyle}>
              {approvals.length === 0
                ? "Nothing pending."
                : `${approvals.length} ${approvals.length === 1 ? "request" : "requests"} waiting on you.`}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            style={closeButtonStyle}
            aria-label="Close approvals inbox"
          >
            ×
          </button>
        </header>

        {error && (
          <div style={errorStyle} role="alert">
            {error}
          </div>
        )}

        {approvals.length === 0 ? (
          <p style={emptyNoteStyle}>
            When an agent fires a destructive tool, it will land here.
          </p>
        ) : (
          <ul style={listStyle}>
            {approvals.map((a) => {
              const agentName = nameById.get(a.agentId) ?? a.agentId;
              const busy = busyId === a.approvalId;
              return (
                <li key={a.approvalId} style={itemStyle}>
                  <div style={itemHeaderStyle}>
                    <div style={metaStyle}>
                      <strong style={agentNameStyle}>{agentName}</strong>
                      <span style={toolNameStyle}>{a.toolName}</span>
                      <span style={timestampStyle}>
                        {formatRelative(a.createdAt)}
                      </span>
                    </div>
                    <div style={buttonRowStyle}>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => {
                          const reason = window.prompt(
                            "Reason for rejecting? (optional)",
                            "",
                          );
                          if (reason === null) return;
                          void handleResolve(
                            a.approvalId,
                            false,
                            reason || undefined,
                          );
                        }}
                        style={rejectButtonStyle(busy)}
                      >
                        Reject
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() =>
                          void handleResolve(a.approvalId, true)
                        }
                        style={approveButtonStyle(busy)}
                      >
                        {busy ? "Working…" : "Approve"}
                      </button>
                    </div>
                  </div>
                  <p style={previewStyle}>{a.preview}</p>
                  {a.detail !== undefined && (
                    <details style={detailsStyle}>
                      <summary style={summaryStyle}>Detail</summary>
                      <pre style={preStyle}>
                        {safeStringify(a.detail)}
                      </pre>
                    </details>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

function formatRelative(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const seconds = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (seconds < 5) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return new Date(iso).toLocaleString();
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

const overlayStyle: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(10, 11, 14, 0.72)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 24,
  zIndex: 1000,
};

const dialogStyle: React.CSSProperties = {
  background: "var(--panel, #14161B)",
  border: "1px solid var(--rule)",
  width: "min(720px, 100%)",
  maxHeight: "min(80vh, 720px)",
  display: "flex",
  flexDirection: "column",
  fontFamily: "var(--font-sans, system-ui)",
  color: "var(--ink)",
  boxShadow: "0 24px 64px rgba(0,0,0,0.45)",
};

const headerStyle: React.CSSProperties = {
  padding: "20px 24px 12px",
  borderBottom: "1px solid var(--rule)",
  display: "flex",
  justifyContent: "space-between",
  alignItems: "flex-start",
  gap: 16,
};

const titleStyle: React.CSSProperties = {
  margin: 0,
  fontFamily: "var(--font-plex-mono)",
  fontSize: 12,
  letterSpacing: "0.18em",
  textTransform: "uppercase",
  color: "var(--ink)",
};

const subtitleStyle: React.CSSProperties = {
  margin: "6px 0 0",
  fontSize: 13,
  color: "var(--ink-dim)",
};

const closeButtonStyle: React.CSSProperties = {
  background: "transparent",
  border: "1px solid var(--rule)",
  color: "var(--ink-dim)",
  width: 28,
  height: 28,
  fontSize: 18,
  lineHeight: "1",
  cursor: "pointer",
};

const errorStyle: React.CSSProperties = {
  margin: "12px 24px 0",
  padding: "8px 12px",
  background: "rgba(224, 141, 92, 0.12)",
  border: "1px solid #E08D5C",
  color: "#F2B68C",
  fontSize: 12,
  fontFamily: "var(--font-plex-mono)",
};

const listStyle: React.CSSProperties = {
  listStyle: "none",
  padding: 0,
  margin: 0,
  overflowY: "auto",
};

const itemStyle: React.CSSProperties = {
  padding: "16px 24px",
  borderBottom: "1px solid var(--rule)",
  display: "flex",
  flexDirection: "column",
  gap: 8,
};

const itemHeaderStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: 12,
  flexWrap: "wrap",
};

const metaStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "baseline",
  gap: 12,
  flexWrap: "wrap",
};

const agentNameStyle: React.CSSProperties = {
  fontSize: 14,
  color: "var(--ink)",
};

const toolNameStyle: React.CSSProperties = {
  fontFamily: "var(--font-plex-mono)",
  fontSize: 11,
  letterSpacing: "0.08em",
  color: "var(--ink-dim)",
};

const timestampStyle: React.CSSProperties = {
  fontFamily: "var(--font-plex-mono)",
  fontSize: 10,
  color: "var(--ink-faint, #4A4A47)",
};

const buttonRowStyle: React.CSSProperties = {
  display: "flex",
  gap: 8,
};

const previewStyle: React.CSSProperties = {
  margin: 0,
  fontSize: 13,
  lineHeight: 1.55,
  color: "var(--ink)",
};

const detailsStyle: React.CSSProperties = {
  border: "1px solid var(--rule)",
  background: "rgba(255,255,255,0.02)",
  padding: "6px 10px",
};

const summaryStyle: React.CSSProperties = {
  cursor: "pointer",
  fontFamily: "var(--font-plex-mono)",
  fontSize: 10,
  letterSpacing: "0.16em",
  textTransform: "uppercase",
  color: "var(--ink-dim)",
};

const preStyle: React.CSSProperties = {
  margin: "8px 0 0",
  fontFamily: "var(--font-plex-mono)",
  fontSize: 11,
  color: "var(--ink-dim)",
  whiteSpace: "pre-wrap",
  wordBreak: "break-word",
  maxHeight: 200,
  overflowY: "auto",
};

const emptyNoteStyle: React.CSSProperties = {
  margin: 0,
  padding: "32px 24px",
  fontSize: 13,
  color: "var(--ink-dim)",
  textAlign: "center",
};

function approveButtonStyle(busy: boolean): React.CSSProperties {
  return {
    padding: "6px 14px",
    background: busy ? "var(--rule)" : "var(--c-cookbook, #7CB89E)",
    color: busy ? "var(--ink-dim)" : "var(--bg, #0F1014)",
    border: `1px solid ${busy ? "var(--rule)" : "var(--c-cookbook, #7CB89E)"}`,
    fontFamily: "var(--font-plex-mono)",
    fontSize: 11,
    letterSpacing: "0.14em",
    textTransform: "uppercase",
    cursor: busy ? "wait" : "pointer",
  };
}

function rejectButtonStyle(busy: boolean): React.CSSProperties {
  return {
    padding: "6px 14px",
    background: "transparent",
    color: busy ? "var(--ink-dim)" : "var(--ink)",
    border: `1px solid ${busy ? "var(--rule)" : "var(--c-forge, #E08D5C)"}`,
    fontFamily: "var(--font-plex-mono)",
    fontSize: 11,
    letterSpacing: "0.14em",
    textTransform: "uppercase",
    cursor: busy ? "wait" : "pointer",
  };
}
