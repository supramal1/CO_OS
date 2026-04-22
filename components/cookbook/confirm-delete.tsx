"use client";

import { useState } from "react";

export function ConfirmDelete({
  name,
  onCancel,
  onDeleted,
}: {
  name: string;
  onCancel: () => void;
  onDeleted: () => void;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const confirm = async () => {
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/cookbook/skills/${encodeURIComponent(name)}`,
        { method: "DELETE" },
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(body?.error ?? `status ${res.status}`);
      }
      onDeleted();
    } catch (err) {
      const message = err instanceof Error ? err.message : "delete failed";
      setError(message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Delete skill"
      onClick={onCancel}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0, 0, 0, 0.6)",
        zIndex: 90,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "min(420px, 100%)",
          background: "var(--panel)",
          border: "1px solid var(--rule-2)",
        }}
      >
        <div style={{ padding: "18px 22px 6px" }}>
          <div
            style={{
              fontFamily: "var(--font-plex-mono)",
              fontSize: 10,
              letterSpacing: "0.14em",
              textTransform: "uppercase",
              color: "var(--c-forge)",
              marginBottom: 8,
            }}
          >
            Delete skill
          </div>
          <p
            style={{
              margin: 0,
              fontFamily: "var(--font-plex-sans)",
              fontSize: 13,
              color: "var(--ink)",
              lineHeight: 1.5,
            }}
          >
            Delete <strong>{name}</strong>? This removes it from the Cookbook
            and can&apos;t be undone from here.
          </p>
          {error && (
            <div
              style={{
                marginTop: 12,
                padding: "6px 10px",
                border: "1px solid var(--c-forge)",
                color: "var(--c-forge)",
                fontFamily: "var(--font-plex-mono)",
                fontSize: 11,
                letterSpacing: "0.06em",
              }}
            >
              {error}
            </div>
          )}
        </div>
        <div
          style={{
            padding: "12px 22px 18px",
            display: "flex",
            justifyContent: "flex-end",
            gap: 10,
          }}
        >
          <button
            type="button"
            onClick={onCancel}
            disabled={submitting}
            style={{
              padding: "6px 12px",
              border: "1px solid var(--rule-2)",
              background: "transparent",
              color: "var(--ink-dim)",
              fontFamily: "var(--font-plex-mono)",
              fontSize: 11,
              letterSpacing: "0.14em",
              textTransform: "uppercase",
              cursor: "pointer",
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={confirm}
            disabled={submitting}
            style={{
              padding: "6px 12px",
              border: "1px solid var(--c-forge)",
              background: "transparent",
              color: "var(--c-forge)",
              fontFamily: "var(--font-plex-mono)",
              fontSize: 11,
              letterSpacing: "0.14em",
              textTransform: "uppercase",
              cursor: submitting ? "default" : "pointer",
              opacity: submitting ? 0.6 : 1,
            }}
          >
            {submitting ? "Deleting…" : "Delete"}
          </button>
        </div>
      </div>
    </div>
  );
}
