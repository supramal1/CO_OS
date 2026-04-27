"use client";

import { useMemo, useState } from "react";
import { estimateDispatchCost } from "@/lib/workforce/cost-estimator";
import type { PublicAgent } from "@/lib/workforce/types";

const DEFAULT_WORKSPACES = [
  { value: "", label: "(use agent default)" },
  { value: "aiops", label: "aiops" },
  { value: "default", label: "default (Mal personal)" },
];

interface Props {
  agents: PublicAgent[];
  /** Pre-select an agent. Used when the form is opened from the agent
   *  panel via "+ Dispatch to X". Falls back to the first lead when the
   *  pre-selection isn't a delegate-capable agent (the runner enforces
   *  this — the UI just hides bad cases). */
  defaultAgentId?: string;
  // Return type is intentionally `unknown`-shaped: callers may return
  // the new task id (so the parent can auto-select), or just void.
  // The form itself doesn't read the result — it only awaits.
  onDispatch: (input: {
    agentId: string;
    description: string;
    targetWorkspace?: string;
    maxCostUsd?: number;
  }) => Promise<unknown>;
}

export function TaskInput({ agents, defaultAgentId, onDispatch }: Props) {
  // v0 only allows Lead-rooted dispatch; the runner enforces but the
  // UI hides the option to avoid a bad user experience.
  const leads = useMemo(() => agents.filter((a) => a.canDelegate), [agents]);
  const initialAgentId =
    defaultAgentId && leads.some((a) => a.id === defaultAgentId)
      ? defaultAgentId
      : leads[0]?.id ?? "";
  const [agentId, setAgentId] = useState<string>(initialAgentId);
  const [description, setDescription] = useState("");
  const [targetWorkspace, setTargetWorkspace] = useState("");
  const [maxCostUsd, setMaxCostUsd] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [errMsg, setErrMsg] = useState<string | null>(null);
  const selectedAgent = useMemo(
    () => agents.find((a) => a.id === agentId),
    [agents, agentId],
  );
  const costEstimate = useMemo(
    () =>
      selectedAgent
        ? estimateDispatchCost({
            agentId: selectedAgent.id,
            model: selectedAgent.model,
            promptChars: description.length,
            canDelegate: selectedAgent.canDelegate,
          })
        : null,
    [description.length, selectedAgent],
  );

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!description.trim() || !agentId) return;
    setSubmitting(true);
    setErrMsg(null);
    const parsedMaxCost =
      maxCostUsd.trim() === "" ? undefined : Number(maxCostUsd);
    if (
      parsedMaxCost !== undefined &&
      (!Number.isFinite(parsedMaxCost) || parsedMaxCost <= 0)
    ) {
      setSubmitting(false);
      setErrMsg("Max cost must be a positive USD amount.");
      return;
    }
    try {
      await onDispatch({
        agentId,
        description: description.trim(),
        targetWorkspace: targetWorkspace || undefined,
        maxCostUsd: parsedMaxCost,
      });
    } catch (err) {
      setErrMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <Field label="Lead">
        <select
          value={agentId}
          onChange={(e) => setAgentId(e.target.value)}
          style={selectStyle}
        >
          {leads.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name} — {a.role}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Workspace">
        <select
          value={targetWorkspace}
          onChange={(e) => setTargetWorkspace(e.target.value)}
          style={selectStyle}
        >
          {DEFAULT_WORKSPACES.map((w) => (
            <option key={w.value} value={w.value}>
              {w.label}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Max cost USD">
        <input
          type="number"
          min="0"
          step="0.01"
          value={maxCostUsd}
          onChange={(e) => setMaxCostUsd(e.target.value)}
          placeholder="5.00"
          style={inputStyle}
        />
      </Field>
      <Field label="Task">
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={6}
          placeholder="Describe what the workforce should do…"
          style={textareaStyle}
        />
      </Field>

      {costEstimate && selectedAgent ? (
        <div aria-live="polite" style={estimateStyle}>
          <strong style={estimateValueStyle}>{costEstimate.label}</strong>
          <span style={estimateMetaStyle}>
            {selectedAgent.name} / {modelLabel(selectedAgent.model)} / rough range
          </span>
        </div>
      ) : null}

      {errMsg ? (
        <p style={{ margin: 0, fontSize: 12, color: "var(--c-forge)" }}>{errMsg}</p>
      ) : null}

      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <button type="submit" disabled={submitting || !description.trim()} style={primaryButtonStyle(submitting)}>
          {submitting ? "Dispatching…" : "Dispatch task"}
        </button>
        <span
          style={{
            fontFamily: "var(--font-plex-mono)",
            fontSize: 10,
            letterSpacing: "0.12em",
            textTransform: "uppercase",
            color: "var(--ink-faint)",
          }}
        >
          Lead delegates downstream
        </span>
      </div>
    </form>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <span
        style={{
          fontFamily: "var(--font-plex-mono)",
          fontSize: 10,
          letterSpacing: "0.14em",
          textTransform: "uppercase",
          color: "var(--ink-dim)",
        }}
      >
        {label}
      </span>
      {children}
    </label>
  );
}

const selectStyle: React.CSSProperties = {
  padding: "8px 10px",
  background: "var(--panel)",
  border: "1px solid var(--rule)",
  color: "var(--ink)",
  fontSize: 13,
};

const inputStyle: React.CSSProperties = {
  padding: "8px 10px",
  background: "var(--panel)",
  border: "1px solid var(--rule)",
  color: "var(--ink)",
  fontSize: 13,
};

const textareaStyle: React.CSSProperties = {
  padding: 12,
  background: "var(--panel)",
  border: "1px solid var(--rule)",
  color: "var(--ink)",
  fontSize: 14,
  lineHeight: 1.55,
  fontFamily: "var(--font-plex-sans)",
  resize: "vertical",
  minHeight: 110,
};

const estimateStyle: React.CSSProperties = {
  padding: "10px 12px",
  background: "var(--panel)",
  border: "1px solid var(--rule)",
  display: "flex",
  flexDirection: "column",
  gap: 4,
};

const estimateValueStyle: React.CSSProperties = {
  fontFamily: "var(--font-plex-mono)",
  fontSize: 13,
  color: "var(--ink)",
};

const estimateMetaStyle: React.CSSProperties = {
  fontSize: 11,
  color: "var(--ink-dim)",
};

function modelLabel(model: string): string {
  const normalized = model.toLowerCase();
  if (normalized.includes("opus")) return "Opus";
  if (normalized.includes("haiku")) return "Haiku";
  return "Sonnet";
}

function primaryButtonStyle(disabled: boolean): React.CSSProperties {
  return {
    padding: "10px 18px",
    background: disabled ? "var(--rule)" : "var(--ink)",
    color: disabled ? "var(--ink-dim)" : "var(--panel)",
    border: "1px solid var(--ink)",
    fontFamily: "var(--font-plex-mono)",
    fontSize: 11,
    letterSpacing: "0.14em",
    textTransform: "uppercase",
  };
}
