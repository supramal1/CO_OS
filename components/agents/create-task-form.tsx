"use client";

import { useState } from "react";
import type { ForgeTask } from "@/lib/agents-types";

export function CreateTaskForm({
  onCreated,
  onError,
  onClose,
}: {
  onCreated: (task: ForgeTask) => void;
  onError: (message: string) => void;
  onClose: () => void;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState(0);
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!title.trim()) {
      onError("Title required");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/forge/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          description: description.trim() || null,
          priority,
        }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? `status ${res.status}`);
      }
      onCreated((await res.json()) as ForgeTask);
      onClose();
    } catch (err) {
      onError(err instanceof Error ? err.message : "create failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.35)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 20,
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 480,
          background: "var(--panel)",
          border: "1px solid var(--rule)",
          padding: 24,
          display: "flex",
          flexDirection: "column",
          gap: 14,
        }}
      >
        <div
          style={{
            fontFamily: "var(--font-plex-mono)",
            fontSize: 10,
            letterSpacing: "0.18em",
            textTransform: "uppercase",
            color: "var(--ink-faint)",
          }}
        >
          New task
        </div>
        <label style={fieldStyle}>
          <span style={labelStyle}>Title</span>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            autoFocus
            style={inputStyle}
          />
        </label>
        <label style={fieldStyle}>
          <span style={labelStyle}>Description</span>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={5}
            style={{ ...inputStyle, resize: "vertical" }}
          />
        </label>
        <label style={fieldStyle}>
          <span style={labelStyle}>Priority</span>
          <input
            type="number"
            value={priority}
            onChange={(e) => setPriority(Number(e.target.value) || 0)}
            style={inputStyle}
          />
        </label>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button type="button" onClick={onClose} style={secondaryBtn}>
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={saving}
            style={{
              fontFamily: "var(--font-plex-mono)",
              fontSize: 11,
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              padding: "8px 14px",
              background: "var(--ink)",
              color: "var(--panel)",
              border: "1px solid var(--ink)",
              cursor: saving ? "default" : "pointer",
              opacity: saving ? 0.6 : 1,
            }}
          >
            {saving ? "Creating…" : "Create"}
          </button>
        </div>
      </div>
    </div>
  );
}

const fieldStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 6,
};
const labelStyle: React.CSSProperties = {
  fontFamily: "var(--font-plex-mono)",
  fontSize: 10,
  letterSpacing: "0.12em",
  textTransform: "uppercase",
  color: "var(--ink-faint)",
};
const inputStyle: React.CSSProperties = {
  fontFamily: "var(--font-plex-sans)",
  fontSize: 14,
  color: "var(--ink)",
  background: "var(--panel)",
  border: "1px solid var(--rule)",
  padding: "8px 10px",
};
const secondaryBtn: React.CSSProperties = {
  fontFamily: "var(--font-plex-mono)",
  fontSize: 11,
  letterSpacing: "0.12em",
  textTransform: "uppercase",
  padding: "8px 14px",
  background: "transparent",
  color: "var(--ink-dim)",
  border: "1px solid var(--rule)",
  cursor: "pointer",
};
