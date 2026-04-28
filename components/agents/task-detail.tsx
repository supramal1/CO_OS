"use client";

import { useEffect, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  buildTaskDetailDisplay,
  type DisplayOutput,
  type DisplayPrContext,
  type DisplayRun,
  type ForgeTaskRunRow,
} from "@/lib/agents-detail-display";
import { AgentActivityBanner } from "@/components/agents/agent-activity-badge";
import { activeStatusForTask } from "@/lib/agents-active-status";
import { formatTaskCostSummary } from "@/lib/agents-cost";
import {
  cancelForgeTaskOptimistically,
  isForgeTaskCancellable,
} from "@/lib/agents-cancel";
import type { ForgeTask, TaskStatus } from "@/lib/agents-types";
import { ALL_STATUSES, STATUS_LABEL } from "@/lib/agents-types";
import { fetchTaskRunRowsForDetail } from "@/lib/agents-run-rows-client";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";

type Props = {
  task: ForgeTask;
  namespace: string | null;
  costUsd: number | null;
  onUpdated: (next: ForgeTask) => void;
  onDeleted: (id: string) => void;
  onSuccess: (message: string) => void;
  onError: (message: string) => void;
  onClose: () => void;
};

type RunsState =
  | { status: "loading" }
  | { status: "loaded"; runs: ForgeTaskRunRow[] }
  | { status: "error"; message: string };

const EMPTY_RUNS: ForgeTaskRunRow[] = [];

export function TaskDetail({
  task,
  namespace,
  costUsd,
  onUpdated,
  onDeleted,
  onSuccess,
  onError,
  onClose,
}: Props) {
  const [saving, setSaving] = useState(false);
  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description ?? "");
  const [priority, setPriority] = useState(task.priority);
  const [runsState, setRunsState] = useState<RunsState>({ status: "loading" });
  const namespaceQuery = namespace
    ? `?namespace=${encodeURIComponent(namespace)}`
    : "";

  useEffect(() => {
    setTitle(task.title);
    setDescription(task.description ?? "");
    setPriority(task.priority);
  }, [task.id, task.title, task.description, task.priority]);

  useEffect(() => {
    let cancelled = false;
    const sb = getSupabaseBrowserClient();
    setRunsState({ status: "loading" });
    if (!sb) {
      setRunsState({ status: "error", message: "Supabase not configured" });
      return;
    }

    const loadRuns = async () => {
      const { rows, error } = await fetchTaskRunRowsForDetail(sb, task.id);
      if (cancelled) return;
      if (error) {
        setRunsState({ status: "error", message: error });
        return;
      }
      setRunsState({ status: "loaded", runs: rows });
    };

    void loadRuns();
    const pollId = window.setInterval(() => {
      if (document.visibilityState !== "hidden") void loadRuns();
    }, 10_000);

    return () => {
      cancelled = true;
      window.clearInterval(pollId);
    };
  }, [task.id]);

  const displayRuns =
    runsState.status === "loaded" ? runsState.runs : EMPTY_RUNS;
  const detailDisplay = useMemo(
    () => buildTaskDetailDisplay(task, displayRuns),
    [task, displayRuns],
  );
  const activityStatus = useMemo(
    () => activeStatusForTask(displayRuns, task.id),
    [displayRuns, task.id],
  );

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

  const cancelTask = async () => {
    setSaving(true);
    try {
      await cancelForgeTaskOptimistically({
        task,
        namespaceQuery,
        confirm: (message) => window.confirm(message),
        fetcher: (input, init) => fetch(input, init),
        onOptimistic: onUpdated,
        onRollback: onUpdated,
        onSuccess: (next) => {
          onUpdated(next);
          onSuccess("Task cancelled");
        },
        onError,
      });
    } finally {
      setSaving(false);
    }
  };

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

      <AgentActivityBanner status={activityStatus} />

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
          {isForgeTaskCancellable(task) ? (
            <button
              type="button"
              onClick={cancelTask}
              disabled={saving}
              style={dangerBtn(saving)}
            >
              Cancel
            </button>
          ) : null}
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

      <ScopeSection rows={detailDisplay.scopeRows} />
      <PrContextSection pr={detailDisplay.pr} />
      <RunTimelineSection state={runsState} runs={detailDisplay.runs} />
      <RunEventsSection state={runsState} runs={detailDisplay.runs} />
      <OutputSection state={runsState} outputs={detailDisplay.outputs} />

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

function ScopeSection({ rows }: { rows: Array<[string, string]> }) {
  return (
    <DetailSection title="Scope">
      {rows.length === 0 ? (
        <EmptyDetail>No scope or brief detail recorded.</EmptyDetail>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {rows.map(([label, value]) => (
            <div key={label}>
              <MetaLabel>{label}</MetaLabel>
              <div style={bodyTextStyle}>{value}</div>
            </div>
          ))}
        </div>
      )}
    </DetailSection>
  );
}

function PrContextSection({ pr }: { pr: DisplayPrContext | null }) {
  return (
    <DetailSection title="PR context">
      {!pr ? (
        <EmptyDetail>No linked PR recorded.</EmptyDetail>
      ) : (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            flexWrap: "wrap",
            fontFamily: "var(--font-plex-mono)",
            fontSize: 12,
          }}
        >
          <span style={statusPillStyle}>{pr.state}</span>
          <span style={{ color: "var(--ink-dim)" }}>
            {pr.number ? `PR #${pr.number}` : "PR"}
          </span>
          <a
            href={pr.url}
            target="_blank"
            rel="noreferrer"
            style={{ color: "var(--ink)", textDecoration: "underline" }}
          >
            {pr.label} ↗
          </a>
        </div>
      )}
    </DetailSection>
  );
}

function RunTimelineSection({
  state,
  runs,
}: {
  state: RunsState;
  runs: DisplayRun[];
}) {
  return (
    <DetailSection title="Run timeline">
      {state.status === "loading" ? (
        <EmptyDetail>Loading runs…</EmptyDetail>
      ) : state.status === "error" ? (
        <EmptyDetail>Couldn&rsquo;t load runs — {state.message}</EmptyDetail>
      ) : runs.length === 0 ? (
        <EmptyDetail>No runs recorded.</EmptyDetail>
      ) : (
        <ol
          style={{
            listStyle: "none",
            margin: 0,
            padding: 0,
            display: "flex",
            flexDirection: "column",
            gap: 8,
          }}
        >
          {runs.map((run) => (
            <li
              key={run.id}
              style={{
                border: "1px solid var(--rule)",
                background: "var(--panel-2)",
                padding: "10px 12px",
              }}
            >
              <div
                style={{
                  display: "flex",
                  gap: 8,
                  alignItems: "center",
                  flexWrap: "wrap",
                }}
              >
                <strong
                  style={{
                    fontSize: 13,
                    fontWeight: 500,
                    color: "var(--ink)",
                  }}
                >
                  {run.label}
                </strong>
                <span style={statusPillStyle}>{run.statusLabel}</span>
                <span style={mutedMonoStyle}>{run.stageLabel}</span>
              </div>
              <div
                style={{
                  marginTop: 6,
                  display: "flex",
                  gap: 12,
                  flexWrap: "wrap",
                  fontFamily: "var(--font-plex-mono)",
                  fontSize: 11,
                  color: "var(--ink-dim)",
                }}
              >
                <span>Created {formatDateTime(run.createdAt)}</span>
                {run.startedAt ? <span>Started {formatDateTime(run.startedAt)}</span> : null}
                {run.completedAt ? (
                  <span>Completed {formatDateTime(run.completedAt)}</span>
                ) : null}
                <span>{formatTaskCostSummary(run.costUsd)}</span>
              </div>
              {run.error ? (
                <div style={{ ...bodyTextStyle, marginTop: 8, color: "#b00020" }}>
                  {run.error}
                </div>
              ) : null}
            </li>
          ))}
        </ol>
      )}
    </DetailSection>
  );
}

function RunEventsSection({
  state,
  runs,
}: {
  state: RunsState;
  runs: DisplayRun[];
}) {
  return (
    <DetailSection title="Logs / events">
      {state.status === "loading" ? (
        <EmptyDetail>Loading events…</EmptyDetail>
      ) : state.status === "error" ? (
        <EmptyDetail>Couldn&rsquo;t load events — {state.message}</EmptyDetail>
      ) : runs.length === 0 ? (
        <EmptyDetail>No runs recorded.</EmptyDetail>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {runs.map((run) => (
            <details key={run.id} style={detailsStyle}>
              <summary style={summaryStyle}>
                {run.label} · {run.events.length}{" "}
                {run.events.length === 1 ? "event" : "events"}
              </summary>
              {run.events.length === 0 ? (
                <EmptyDetail>No events recorded for this run.</EmptyDetail>
              ) : (
                <ol style={eventListStyle}>
                  {run.events.map((event, index) => (
                    <li key={`${run.id}:${index}`} style={eventRowStyle}>
                      <span style={{ color: "var(--ink-faint)", width: 120 }}>
                        {event.timestamp ? formatDateTime(event.timestamp) : "No time"}
                      </span>
                      <span style={{ color: "var(--ink-dim)", width: 120 }}>
                        {event.type}
                      </span>
                      <span style={{ color: "var(--ink)" }}>{event.summary}</span>
                    </li>
                  ))}
                </ol>
              )}
            </details>
          ))}
        </div>
      )}
    </DetailSection>
  );
}

function OutputSection({
  state,
  outputs,
}: {
  state: RunsState;
  outputs: DisplayOutput[];
}) {
  return (
    <DetailSection title="Output">
      {state.status === "loading" ? (
        <EmptyDetail>Loading output…</EmptyDetail>
      ) : state.status === "error" ? (
        <EmptyDetail>Couldn&rsquo;t load output — {state.message}</EmptyDetail>
      ) : outputs.length === 0 ? (
        <EmptyDetail>No run output recorded.</EmptyDetail>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {outputs.map((output) => (
            <details key={`${output.runId}:${output.kind}`} open style={detailsStyle}>
              <summary style={summaryStyle}>
                {output.runLabel} · {formatDateTime(output.createdAt)}
              </summary>
              {output.kind === "markdown" ? (
                <article style={markdownOutputStyle}>
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {output.value as string}
                  </ReactMarkdown>
                </article>
              ) : (
                <pre style={preStyle}>
                  {JSON.stringify(output.value, null, 2)}
                </pre>
              )}
            </details>
          ))}
        </div>
      )}
    </DetailSection>
  );
}

function DetailSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section style={sectionStyle}>
      <div style={sectionTitleStyle}>{title}</div>
      {children}
    </section>
  );
}

function MetaLabel({ children }: { children: React.ReactNode }) {
  return <div style={metaLabelStyle}>{children}</div>;
}

function EmptyDetail({ children }: { children: React.ReactNode }) {
  return <p style={emptyTextStyle}>{children}</p>;
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

const sectionStyle: React.CSSProperties = {
  padding: "16px 24px",
  borderTop: "1px solid var(--rule)",
};

const sectionTitleStyle: React.CSSProperties = {
  fontFamily: "var(--font-plex-mono)",
  fontSize: 10,
  letterSpacing: "0.18em",
  textTransform: "uppercase",
  color: "var(--ink-faint)",
  marginBottom: 10,
};

const metaLabelStyle: React.CSSProperties = {
  fontFamily: "var(--font-plex-mono)",
  fontSize: 10,
  letterSpacing: "0.12em",
  textTransform: "uppercase",
  color: "var(--ink-dim)",
  marginBottom: 4,
};

const bodyTextStyle: React.CSSProperties = {
  fontFamily: "var(--font-plex-sans)",
  fontSize: 13,
  lineHeight: 1.5,
  color: "var(--ink)",
  whiteSpace: "pre-wrap",
};

const emptyTextStyle: React.CSSProperties = {
  margin: 0,
  fontFamily: "var(--font-plex-sans)",
  fontSize: 12,
  lineHeight: 1.45,
  color: "var(--ink-faint)",
};

const mutedMonoStyle: React.CSSProperties = {
  fontFamily: "var(--font-plex-mono)",
  fontSize: 11,
  color: "var(--ink-dim)",
};

const statusPillStyle: React.CSSProperties = {
  padding: "2px 7px",
  background: "var(--panel)",
  border: "1px solid var(--rule)",
  color: "var(--ink-dim)",
  fontFamily: "var(--font-plex-mono)",
  fontSize: 10,
  letterSpacing: "0.1em",
  textTransform: "uppercase",
};

const detailsStyle: React.CSSProperties = {
  border: "1px solid var(--rule)",
  background: "var(--panel-2)",
};

const summaryStyle: React.CSSProperties = {
  padding: "9px 12px",
  cursor: "pointer",
  fontFamily: "var(--font-plex-mono)",
  fontSize: 11,
  color: "var(--ink-dim)",
};

const eventListStyle: React.CSSProperties = {
  listStyle: "none",
  margin: 0,
  padding: "0 12px 12px",
  display: "flex",
  flexDirection: "column",
  gap: 5,
};

const eventRowStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "120px 120px minmax(0, 1fr)",
  gap: 10,
  fontFamily: "var(--font-plex-mono)",
  fontSize: 11,
  lineHeight: 1.4,
};

const markdownOutputStyle: React.CSSProperties = {
  margin: "0 12px 12px",
  padding: 12,
  background: "var(--panel)",
  border: "1px solid var(--rule)",
  fontSize: 13,
  lineHeight: 1.55,
  color: "var(--ink)",
  maxHeight: 360,
  overflow: "auto",
};

const preStyle: React.CSSProperties = {
  margin: "0 12px 12px",
  padding: 12,
  background: "var(--panel)",
  border: "1px solid var(--rule)",
  fontFamily: "var(--font-plex-mono)",
  fontSize: 11,
  lineHeight: 1.5,
  color: "var(--ink-dim)",
  whiteSpace: "pre-wrap",
  wordBreak: "break-word",
  maxHeight: 360,
  overflow: "auto",
};

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
