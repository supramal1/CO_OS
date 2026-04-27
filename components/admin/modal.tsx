"use client";

import type { CSSProperties, ReactNode } from "react";

export function Modal({
  title,
  children,
  onClose,
  width = 520,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  width?: number;
}) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.55)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 40,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: `min(${width}px, 92vw)`,
          maxHeight: "88vh",
          overflowY: "auto",
          background: "var(--panel)",
          border: "1px solid var(--rule-2)",
          padding: "20px 24px 16px",
          display: "flex",
          flexDirection: "column",
          gap: 14,
        }}
      >
        <h2
          style={{
            margin: 0,
            fontFamily: "var(--font-plex-serif)",
            fontWeight: 400,
            fontSize: 18,
            color: "var(--ink)",
          }}
        >
          {title}
        </h2>
        {children}
      </div>
    </div>
  );
}

export function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <span
        style={{
          fontFamily: "var(--font-plex-mono)",
          fontSize: 10,
          letterSpacing: "0.14em",
          textTransform: "uppercase",
          color: "var(--ink-faint)",
        }}
      >
        {label}
      </span>
      {children}
    </label>
  );
}

export type ModalFooterTone = "default" | "warn" | "danger";

export function ModalFooter({
  primaryLabel,
  primaryDisabled,
  primaryTone = "default",
  cancelLabel = "Cancel",
  onPrimary,
  onCancel,
}: {
  primaryLabel: string;
  primaryDisabled?: boolean;
  primaryTone?: ModalFooterTone;
  cancelLabel?: string;
  onPrimary: () => void;
  onCancel: () => void;
}) {
  const bg =
    primaryTone === "danger"
      ? "var(--c-forge)"
      : primaryTone === "warn"
        ? "var(--c-cookbook)"
        : "var(--ink)";
  const fg = primaryTone === "default" ? "var(--panel)" : "var(--bg)";
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "flex-end",
        gap: 8,
        marginTop: 4,
      }}
    >
      <button
        type="button"
        onClick={onCancel}
        style={{
          fontFamily: "var(--font-plex-mono)",
          fontSize: 11,
          letterSpacing: "0.12em",
          textTransform: "uppercase",
          padding: "6px 12px",
          background: "transparent",
          color: "var(--ink-dim)",
          border: "1px solid var(--rule)",
          cursor: "pointer",
        }}
      >
        {cancelLabel}
      </button>
      <button
        type="button"
        onClick={onPrimary}
        disabled={primaryDisabled}
        style={{
          fontFamily: "var(--font-plex-mono)",
          fontSize: 11,
          letterSpacing: "0.12em",
          textTransform: "uppercase",
          padding: "6px 12px",
          background: bg,
          color: fg,
          border: `1px solid ${bg}`,
          cursor: primaryDisabled ? "not-allowed" : "pointer",
          opacity: primaryDisabled ? 0.5 : 1,
        }}
      >
        {primaryLabel}
      </button>
    </div>
  );
}

export const modalInputStyle: CSSProperties = {
  padding: "8px 10px",
  fontFamily: "var(--font-plex-mono)",
  fontSize: 13,
  color: "var(--ink)",
  background: "var(--bg)",
  border: "1px solid var(--rule)",
  width: "100%",
};

export function Empty({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        padding: "60px 20px",
        textAlign: "center",
        fontFamily: "var(--font-plex-sans)",
        fontSize: 14,
        color: "var(--ink-dim)",
      }}
    >
      {children}
    </div>
  );
}

export function Toast({
  message,
  onDismiss,
}: {
  message: string;
  onDismiss: () => void;
}) {
  return (
    <div
      role="alert"
      onClick={onDismiss}
      style={{
        position: "fixed",
        right: 24,
        bottom: 24,
        padding: "10px 14px",
        background: "var(--ink)",
        color: "var(--panel)",
        fontFamily: "var(--font-plex-sans)",
        fontSize: 13,
        zIndex: 50,
        cursor: "pointer",
      }}
    >
      {message}
    </div>
  );
}
