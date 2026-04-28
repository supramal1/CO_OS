"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { ForgeTask } from "@/lib/agents-types";
import { LANE_LABEL } from "@/lib/agents-types";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";

// Scope shape — mirrors forge_task_runs.output.scope written by PM.
type Scope = {
  problem?: string;
  approach?: string;
  risks?: string;
  open_questions?: string;
  estimated_effort?: string;
};

const SCOPE_FIELDS: ReadonlyArray<{
  key: keyof Scope;
  label: string;
  rows: number;
}> = [
  { key: "problem", label: "Problem", rows: 4 },
  { key: "approach", label: "Approach", rows: 6 },
  { key: "risks", label: "Risks", rows: 4 },
  { key: "open_questions", label: "Open questions", rows: 4 },
  { key: "estimated_effort", label: "Estimated effort", rows: 2 },
];

type PausedRun = {
  id: string;
  task_id: string;
  output: { scope?: Scope; submitted_at?: string } | null;
  created_at: string;
};

type TasksState =
  | { status: "loading" }
  | { status: "empty" }
  | { status: "error"; message: string }
  | { status: "loaded"; tasks: ForgeTask[]; runsByTask: Record<string, PausedRun> };

export function ResearchReview() {
  const [state, setState] = useState<TasksState>({ status: "loading" });
  const [activeId, setActiveId] = useState<string | null>(null);
  const [toast, setToast] = useState<{ kind: "error" | "ok"; message: string } | null>(
    null,
  );

  const load = useCallback(async () => {
    const sb = getSupabaseBrowserClient();
    if (!sb) {
      setState({ status: "error", message: "Supabase not configured" });
      return;
    }
    try {
      const { data: tasks, error: tErr } = await sb
        .from("forge_tasks")
        .select(
          "id, title, description, lane, status, agent_id, priority, creator_type, creator_id, assignee_type, assignee_id, metadata, namespace, created_at, updated_at",
        )
        .eq("lane", "research_review")
        .order("updated_at", { ascending: false });
      if (tErr) throw tErr;
      if (!tasks || tasks.length === 0) {
        setState({ status: "empty" });
        return;
      }

      const taskIds = tasks.map((t) => t.id);
      const { data: runs, error: rErr } = await sb
        .from("forge_task_runs")
        .select("id, task_id, output, created_at")
        .in("task_id", taskIds)
        .eq("run_type", "pm_orchestration")
        .eq("stage", "awaiting_review")
        .order("created_at", { ascending: false });
      if (rErr) throw rErr;

      // One paused PM run per task by design; newest-first order picks
      // the canonical one if the backend ever regresses and leaves two.
      const runsByTask: Record<string, PausedRun> = {};
      for (const r of (runs ?? []) as PausedRun[]) {
        if (!runsByTask[r.task_id]) runsByTask[r.task_id] = r;
      }

      setState({
        status: "loaded",
        tasks: tasks as ForgeTask[],
        runsByTask,
      });
      setActiveId((prev) => prev ?? (tasks[0]?.id as string));
    } catch (err) {
      setState({
        status: "error",
        message: err instanceof Error ? err.message : "failed to load",
      });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const activeTask = useMemo(() => {
    if (state.status !== "loaded" || !activeId) return null;
    return state.tasks.find((t) => t.id === activeId) ?? null;
  }, [state, activeId]);

  const activeRun = useMemo(() => {
    if (state.status !== "loaded" || !activeId) return null;
    return state.runsByTask[activeId] ?? null;
  }, [state, activeId]);

  const handleScopeSaved = (runId: string, scope: Scope) => {
    setState((prev) => {
      if (prev.status !== "loaded") return prev;
      const existing = Object.values(prev.runsByTask).find((r) => r.id === runId);
      if (!existing) return prev;
      const nextRun: PausedRun = {
        ...existing,
        output: { ...(existing.output ?? {}), scope },
      };
      return {
        ...prev,
        runsByTask: { ...prev.runsByTask, [existing.task_id]: nextRun },
      };
    });
    setToast({ kind: "ok", message: "Scope saved" });
  };

  const handleApprove = async (task: ForgeTask) => {
    try {
      const res = await fetch(`/api/forge/tasks/${task.id}/transition`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          namespace: task.namespace,
          from_lane: "research_review",
          to_lane: "production",
        }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as {
          error?: string;
          detail?: string;
        };
        throw new Error(data.detail ?? data.error ?? `status ${res.status}`);
      }
      setToast({ kind: "ok", message: `${task.title} → Production` });
      // Optimistically remove from local list — Realtime on the kanban
      // will also pick this up and move the card.
      setState((prev) => {
        if (prev.status !== "loaded") return prev;
        const tasks = prev.tasks.filter((t) => t.id !== task.id);
        if (tasks.length === 0) return { status: "empty" };
        return { ...prev, tasks };
      });
      setActiveId(null);
    } catch (err) {
      setToast({
        kind: "error",
        message: err instanceof Error ? err.message : "approve failed",
      });
    }
  };

  return (
    <div
      style={{
        height: "calc(100vh - var(--shell-h) - var(--forge-subnav-h, 44px))",
        display: "grid",
        gridTemplateColumns: "minmax(280px, 320px) minmax(0, 1fr)",
        minHeight: 0,
      }}
    >
      <aside
        style={{
          borderRight: "1px solid var(--rule)",
          display: "flex",
          flexDirection: "column",
          minHeight: 0,
        }}
      >
        <div
          style={{
            padding: "14px 18px",
            borderBottom: "1px solid var(--rule)",
            fontFamily: "var(--font-plex-mono)",
            fontSize: 10,
            letterSpacing: "0.16em",
            textTransform: "uppercase",
            color: "var(--ink-dim)",
          }}
        >
          Awaiting review
          {state.status === "loaded" ? (
            <span style={{ marginLeft: 8, color: "var(--ink-faint)" }}>
              {state.tasks.length}
            </span>
          ) : null}
        </div>
        <div style={{ flex: 1, overflow: "auto", padding: "8px 10px" }}>
          {state.status === "loading" ? (
            <Empty>Loading…</Empty>
          ) : state.status === "error" ? (
            <Empty>Couldn&rsquo;t load — {state.message}</Empty>
          ) : state.status === "empty" ? (
            <Empty>No tasks in {LANE_LABEL.research_review}.</Empty>
          ) : (
            state.tasks.map((t) => (
              <TaskRow
                key={t.id}
                task={t}
                active={t.id === activeId}
                onSelect={() => setActiveId(t.id)}
              />
            ))
          )}
        </div>
      </aside>

      <section
        style={{
          display: "flex",
          flexDirection: "column",
          minHeight: 0,
          overflow: "hidden",
        }}
      >
        {activeTask ? (
          <ScopeEditor
            key={activeTask.id}
            task={activeTask}
            run={activeRun}
            onSaved={handleScopeSaved}
            onApprove={() => handleApprove(activeTask)}
          />
        ) : (
          <Empty>Select a task to review.</Empty>
        )}
      </section>

      {toast ? (
        <div
          role="alert"
          onClick={() => setToast(null)}
          style={{
            position: "fixed",
            right: 24,
            bottom: 24,
            padding: "10px 14px",
            background: toast.kind === "error" ? "var(--ink)" : "var(--ink)",
            color: "var(--panel)",
            fontFamily: "var(--font-plex-sans)",
            fontSize: 13,
            zIndex: 30,
            cursor: "pointer",
            maxWidth: 360,
          }}
        >
          {toast.message}
        </div>
      ) : null}
    </div>
  );
}

function TaskRow({
  task,
  active,
  onSelect,
}: {
  task: ForgeTask;
  active: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      style={{
        display: "block",
        width: "100%",
        textAlign: "left",
        padding: "10px 12px",
        marginBottom: 4,
        background: active ? "var(--panel-2)" : "transparent",
        border: active ? "1px solid var(--rule)" : "1px solid transparent",
        fontFamily: "var(--font-plex-sans)",
        color: "var(--ink)",
        cursor: "pointer",
      }}
    >
      <div style={{ fontSize: 13, fontWeight: 500 }}>{task.title}</div>
      <div
        style={{
          marginTop: 4,
          fontFamily: "var(--font-plex-mono)",
          fontSize: 10,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          color: "var(--ink-faint)",
        }}
      >
        {task.namespace}
      </div>
      {task.description ? (
        <div
          style={{
            marginTop: 3,
            fontSize: 12,
            color: "var(--ink-dim)",
            overflow: "hidden",
            display: "-webkit-box",
            WebkitBoxOrient: "vertical",
            WebkitLineClamp: 2,
          }}
        >
          {task.description}
        </div>
      ) : null}
    </button>
  );
}

function ScopeEditor({
  task,
  run,
  onSaved,
  onApprove,
}: {
  task: ForgeTask;
  run: PausedRun | null;
  onSaved: (runId: string, scope: Scope) => void;
  onApprove: () => void;
}) {
  const baseline = (run?.output?.scope ?? {}) as Scope;
  const [draft, setDraft] = useState<Scope>(baseline);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset draft when the selected task (and therefore run) changes.
  // useState initialiser runs once per mount and `key={activeTask.id}`
  // on the parent forces a remount, so this handles that cleanly.

  const dirty = useMemo(() => {
    for (const { key } of SCOPE_FIELDS) {
      if ((draft[key] ?? "") !== (baseline[key] ?? "")) return true;
    }
    return false;
  }, [draft, baseline]);

  const handleSave = async () => {
    if (!run) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/forge/task-runs/${run.id}/scope`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as {
          error?: string;
          detail?: string;
        };
        throw new Error(data.detail ?? data.error ?? `status ${res.status}`);
      }
      const data = (await res.json()) as { scope: Scope };
      onSaved(run.id, data.scope);
    } catch (err) {
      setError(err instanceof Error ? err.message : "save failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <header
        style={{
          padding: "18px 24px",
          borderBottom: "1px solid var(--rule)",
          display: "flex",
          alignItems: "baseline",
          gap: 12,
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontFamily: "var(--font-plex-mono)",
              fontSize: 10,
              letterSpacing: "0.16em",
              textTransform: "uppercase",
              color: "var(--ink-faint)",
            }}
          >
            Scope review
          </div>
          <h2
            style={{
              margin: "4px 0 0 0",
              fontSize: 18,
              fontWeight: 500,
              color: "var(--ink)",
            }}
          >
            {task.title}
          </h2>
          <div
            style={{
              marginTop: 6,
              fontFamily: "var(--font-plex-mono)",
              fontSize: 10,
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              color: "var(--ink-faint)",
            }}
          >
            {task.namespace}
          </div>
        </div>
        <button
          type="button"
          onClick={handleSave}
          disabled={!run || !dirty || saving}
          style={buttonSecondaryStyle(!run || !dirty || saving)}
        >
          {saving ? "Saving…" : "Save edits"}
        </button>
        <button
          type="button"
          onClick={onApprove}
          disabled={!run || dirty}
          title={dirty ? "Save or discard edits before approving" : undefined}
          style={buttonPrimaryStyle(!run || dirty)}
        >
          Approve → Production
        </button>
      </header>

      <div
        style={{
          flex: 1,
          overflow: "auto",
          padding: "20px 24px",
          display: "flex",
          flexDirection: "column",
          gap: 18,
        }}
      >
        {!run ? (
          <p
            style={{
              margin: 0,
              fontSize: 13,
              color: "var(--ink-dim)",
              lineHeight: 1.5,
            }}
          >
            No paused PM run found for this task. The scope may still be in
            flight, or the backend has already advanced the gate.
          </p>
        ) : (
          <>
            {SCOPE_FIELDS.map(({ key, label, rows }) => (
              <ScopeField
                key={key}
                label={label}
                rows={rows}
                value={draft[key] ?? ""}
                onChange={(v) => setDraft((d) => ({ ...d, [key]: v }))}
              />
            ))}
            {run.output?.submitted_at ? (
              <div
                style={{
                  fontFamily: "var(--font-plex-mono)",
                  fontSize: 10,
                  color: "var(--ink-faint)",
                  letterSpacing: "0.12em",
                }}
              >
                PM submitted {new Date(run.output.submitted_at).toLocaleString()}
              </div>
            ) : null}
            {error ? (
              <div
                style={{
                  fontSize: 12,
                  color: "#b00020",
                  fontFamily: "var(--font-plex-mono)",
                }}
              >
                {error}
              </div>
            ) : null}
          </>
        )}
      </div>
    </>
  );
}

function ScopeField({
  label,
  rows,
  value,
  onChange,
}: {
  label: string;
  rows: number;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div>
      <label
        style={{
          display: "block",
          fontFamily: "var(--font-plex-mono)",
          fontSize: 10,
          letterSpacing: "0.14em",
          textTransform: "uppercase",
          color: "var(--ink-dim)",
          marginBottom: 6,
        }}
      >
        {label}
      </label>
      <textarea
        value={value}
        rows={rows}
        onChange={(e) => onChange(e.target.value)}
        style={{
          width: "100%",
          padding: "10px 12px",
          background: "var(--panel)",
          border: "1px solid var(--rule)",
          color: "var(--ink)",
          fontFamily: "var(--font-plex-sans)",
          fontSize: 13,
          lineHeight: 1.5,
          resize: "vertical",
        }}
      />
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
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

function buttonPrimaryStyle(disabled: boolean): React.CSSProperties {
  return {
    padding: "8px 14px",
    background: disabled ? "var(--panel-2)" : "var(--ink)",
    border: "1px solid var(--ink)",
    color: disabled ? "var(--ink-faint)" : "var(--panel)",
    fontFamily: "var(--font-plex-mono)",
    fontSize: 11,
    letterSpacing: "0.12em",
    textTransform: "uppercase",
    cursor: disabled ? "not-allowed" : "pointer",
  };
}

function buttonSecondaryStyle(disabled: boolean): React.CSSProperties {
  return {
    padding: "8px 14px",
    background: "transparent",
    border: "1px solid var(--rule)",
    color: disabled ? "var(--ink-faint)" : "var(--ink-dim)",
    fontFamily: "var(--font-plex-mono)",
    fontSize: 11,
    letterSpacing: "0.12em",
    textTransform: "uppercase",
    cursor: disabled ? "not-allowed" : "pointer",
  };
}
