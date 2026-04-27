"use client";

import { useState } from "react";
import { formatTaskCostSummary } from "@/lib/agents-cost";
import type { ForgeTask, TaskStatus } from "@/lib/agents-types";
import { ALL_STATUSES, STATUS_LABEL } from "@/lib/agents-types";

type Props = {
  task: ForgeTask;
  namespace: string | null;
  costUsd: number | null;
  onUpdated: (next: ForgeTask) => void;
  onDeleted: (id: string) => void;
  onError: (message: string) => void;
  onClose: () => void;
};

export function TaskDetail({
  task,
  namespace,
  costUsd,
  onUpdated,
  onDeleted,
  onError,
  onClose,
}: Props) {
  const [saving, setSaving] = useState(false);
  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description ?? "");
  const [priority, setPriority] = useState(task.priority);
  const namespaceQuery = namespace
    ? `?namespace=${encodeURIComponent(namespace)}`
    : "";

  const patch = async (body: Record<string, unknown>) => {
    setSaving(true);
    try {
      const res = await fetch(`/api/forge/tasks/${task.id}${namespaceQuery}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? `status ${res.status}`);
      }
      onUpdated((await res.json()) as ForgeTask);
    } catch (err) {
      onError(err instanceof Error ? err.message : "update failed");
    } finally {
      setSaving(false);
    }
  };

  const saveEdits = () =>
    patch({
      title,
      description: description || null,
      priority,
    });

  const setStatus = (status: TaskStatus) => patch({ status });

  const remove = async () => {
    if (!window.confirm(`Delete task "${task.title}"?`)) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/forge/tasks/${task.id}${namespaceQuery}`, {
        method: "DELETE",
      });
      if (!res.ok && res.status !== 204) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? `status ${res.status}`);
      }
      onDeleted(task.id);
    } catch (err) {
      onError(err instanceof Error ? err.message : "delete failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        overflow: "auto",
      }}
    >
      <div
        style={{
          padding: "20px 24px",
          borderBottom: "1px solid var(--rule)",
          display: "flex",
          alignItems: "center",
          gap: 10,
        }}
      >
        <div
          style={{
            flex: 1,
            fontFamily: "var(--font-plex-mono)",
            fontSize: 10,
            letterSpacing: "0.18em",
            textTransform: "uppercase",
            color: "var(--ink-faint)",
          }}
        >
          Task · {task.id.slice(0, 8)}
        </div>
        <button
          type="button"
          onClick={onClose}
          style={{
            background: "transparent",
            border: "1px solid var(--rule)",
            color: "var(--ink-dim)",
            fontFamily: "var(--font-plex-mono)",
            fontSize: 11,
            padding: "4px 10px",
            cursor: "pointer",
          }}
        >
          Close
        </button>
      </div>

      <div
        style={{
          padding: "20px 24px",
          display: "flex",
          flexDirection: "column",
          gap: 14,
        }}
      >
        <LabeledInput label="Title" value={title} onChange={setTitle} />
        <LabeledTextarea
          label="Description"
          value={description}
          onChange={setDescription}
        />
        <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <span
            style={{
              fontFamily: "var(--font-plex-mono)",
              fontSize: 10,
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              color: "var(--ink-faint)",
            }}
          >
            Priority
          </span>
          <input
            type="number"
            value={priority}
            onChange={(e) => setPriority(Number(e.target.value) || 0)}
            style={inputStyle}
          />
        </label>
        <div style={{ display: "flex", gap: 8 }}>
          <button
            type="button"
            onClick={saveEdits}
            disabled={saving}
            style={primaryBtn(saving)}
          >
            {saving ? "Saving…" : "Save"}
          </button>
          <button
            type="button"
            onClick={remove}
            disabled={saving}
            style={dangerBtn(saving)}
          >
            Delete
          </button>
        </div>
      </div>

      <section
        style={{
          padding: "16px 24px",
          borderTop: "1px solid var(--rule)",
        }}
      >
        <div
          style={{
            fontFamily: "var(--font-plex-mono)",
            fontSize: 10,
            letterSpacing: "0.18em",
            textTransform: "uppercase",
            color: "var(--ink-faint)",
            marginBottom: 8,
          }}
        >
          Cost
        </div>
        <div
          aria-label="Task cost summary"
          style={{
            fontFamily: "var(--font-plex-mono)",
            fontSize: 18,
            color: costUsd === null ? "var(--ink-dim)" : "var(--ink)",
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {formatTaskCostSummary(costUsd)}
        </div>
        <p
          style={{
            margin: "8px 0 0",
            fontFamily: "var(--font-plex-sans)",
            fontSize: 12,
            lineHeight: 1.45,
            color: "var(--ink-faint)",
          }}
        >
          Sum of completed Forge runs recorded for this task.
        </p>
      </section>

      <div
        style={{
          padding: "16px 24px",
          borderTop: "1px solid var(--rule)",
        }}
      >
        <div
          style={{
            fontFamily: "var(--font-plex-mono)",
            fontSize: 10,
            letterSpacing: "0.18em",
            textTransform: "uppercase",
            color: "var(--ink-faint)",
            marginBottom: 10,
          }}
        >
          Status
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {ALL_STATUSES.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setStatus(s)}
              disabled={saving || s === task.status}
              style={{
                fontFamily: "var(--font-plex-mono)",
                fontSize: 11,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                padding: "6px 10px",
                background: s === task.status ? "var(--ink)" : "transparent",
                color: s === task.status ? "var(--panel)" : "var(--ink)",
                border: "1px solid var(--rule)",
                cursor: saving || s === task.status ? "default" : "pointer",
                opacity: saving ? 0.6 : 1,
              }}
            >
              {STATUS_LABEL[s]}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  fontFamily: "var(--font-plex-sans)",
  fontSize: 14,
  color: "var(--ink)",
  background: "var(--panel)",
  border: "1px solid var(--rule)",
  padding: "8px 10px",
};

function primaryBtn(disabled: boolean): React.CSSProperties {
  return {
    fontFamily: "var(--font-plex-mono)",
    fontSize: 11,
    letterSpacing: "0.12em",
    textTransform: "uppercase",
    padding: "8px 14px",
    background: "var(--ink)",
    color: "var(--panel)",
    border: "1px solid var(--ink)",
    cursor: disabled ? "default" : "pointer",
    opacity: disabled ? 0.6 : 1,
  };
}

function dangerBtn(disabled: boolean): React.CSSProperties {
  return {
    fontFamily: "var(--font-plex-mono)",
    fontSize: 11,
    letterSpacing: "0.12em",
    textTransform: "uppercase",
    padding: "8px 14px",
    background: "transparent",
    color: "#c0392b",
    border: "1px solid #c0392b",
    cursor: disabled ? "default" : "pointer",
    opacity: disabled ? 0.6 : 1,
  };
}

function LabeledInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
}) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <span
        style={{
          fontFamily: "var(--font-plex-mono)",
          fontSize: 10,
          letterSpacing: "0.12em",
          textTransform: "uppercase",
          color: "var(--ink-faint)",
        }}
      >
        {label}
      </span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={inputStyle}
      />
    </label>
  );
}

function LabeledTextarea({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
}) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <span
        style={{
          fontFamily: "var(--font-plex-mono)",
          fontSize: 10,
          letterSpacing: "0.12em",
          textTransform: "uppercase",
          color: "var(--ink-faint)",
        }}
      >
        {label}
      </span>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={5}
        style={{ ...inputStyle, resize: "vertical" }}
      />
    </label>
  );
}
