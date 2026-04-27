"use client";

import { useState } from "react";
import { Modal, ModalFooter } from "./modal";

export function CredentialReveal({
  rawKey,
  onClose,
}: {
  rawKey: string;
  onClose: () => void;
}) {
  const [acked, setAcked] = useState(false);
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    await navigator.clipboard.writeText(rawKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  return (
    <Modal title="API key created" onClose={() => acked && onClose()}>
      <p
        style={{
          margin: 0,
          fontFamily: "var(--font-plex-sans)",
          fontSize: 14,
          color: "var(--ink-dim)",
        }}
      >
        Copy this key now. It will not be shown again.
      </p>
      <div
        style={{
          padding: "12px 14px",
          background: "var(--bg)",
          border: "1px solid var(--rule-2)",
          fontFamily: "var(--font-plex-mono)",
          fontSize: 13,
          color: "var(--ink)",
          wordBreak: "break-all",
          userSelect: "all",
        }}
      >
        {rawKey}
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <button
          type="button"
          onClick={copy}
          style={{
            fontFamily: "var(--font-plex-mono)",
            fontSize: 11,
            letterSpacing: "0.12em",
            textTransform: "uppercase",
            padding: "6px 12px",
            background: "transparent",
            color: "var(--ink)",
            border: "1px solid var(--rule-2)",
            cursor: "pointer",
          }}
        >
          {copied ? "Copied ✓" : "Copy"}
        </button>
      </div>
      <div
        style={{
          padding: "8px 12px",
          background: "var(--panel-2)",
          borderLeft: "2px solid var(--c-cookbook)",
          fontFamily: "var(--font-plex-sans)",
          fontSize: 13,
          color: "var(--c-cookbook)",
        }}
      >
        This key cannot be recovered. Save it before closing.
      </div>
      <label
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          cursor: "pointer",
          fontFamily: "var(--font-plex-sans)",
          fontSize: 13,
          color: "var(--ink)",
        }}
      >
        <input
          type="checkbox"
          checked={acked}
          onChange={(e) => setAcked(e.target.checked)}
        />
        I have saved this key somewhere safe
      </label>
      <ModalFooter
        primaryLabel="Close"
        primaryDisabled={!acked}
        onPrimary={onClose}
        onCancel={onClose}
        cancelLabel="Cancel"
      />
    </Modal>
  );
}
