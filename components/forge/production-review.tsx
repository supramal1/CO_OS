"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { ForgeTask } from "@/lib/agents-types";
import { LANE_LABEL } from "@/lib/agents-types";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";

// Mirrors the server route's PrEmbed shape. Kept local rather than
// factored into lib/ because it's the only caller.
type PrEmbed = {
  run_id: string;
  task_id: string;
  pr_url: string;
  builder_summary: {
    risks?: string;
    tests_run?: string;
    files_changed?: string;
    follow_ups_suggested?: string;
    error?: string;
  } | null;
  submitted_at: string | null;
  pr: {
    title: string;
    state: "open" | "closed" | "draft" | "merged";
    body: string | null;
    additions: number;
    deletions: number;
    changed_files: number;
    commits: number;
    html_url: string;
    head_ref: string;
    base_ref: string;
    author: string | null;
    updated_at: string;
  } | null;
  pr_error: string | null;
};

type TasksState =
  | { status: "loading" }
  | { status: "empty" }
  | { status: "error"; message: string }
  | { status: "loaded"; tasks: ForgeTask[] };

type EmbedState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "loaded"; embed: PrEmbed }
  | { status: "error"; message: string };

export function ProductionReview() {
  const [tasksState, setTasksState] = useState<TasksState>({ status: "loading" });
  const [activeId, setActiveId] = useState<string | null>(null);
  const [toast, setToast] = useState<{ kind: "error" | "ok"; message: string } | null>(
    null,
  );

  const loadTasks = useCallback(async () => {
    const sb = getSupabaseBrowserClient();
    if (!sb) {
      setTasksState({ status: "error", message: "Supabase not configured" });
      return;
    }
    try {
      const { data, error } = await sb
        .from("forge_tasks")
        .select(
          "id, title, description, lane, status, agent_id, priority, creator_type, creator_id, assignee_type, assignee_id, metadata, namespace, created_at, updated_at",
        )
        .eq("lane", "production_review")
        .eq("namespace", "default")
        .order("updated_at", { ascending: false });
      if (error) throw error;
      if (!data || data.length === 0) {
        setTasksState({ status: "empty" });
        return;
      }
      setTasksState({ status: "loaded", tasks: data as ForgeTask[] });
      setActiveId((prev) => prev ?? (data[0]?.id as string));
    } catch (err) {
      setTasksState({
        status: "error",
        message: err instanceof Error ? err.message : "failed to load",
      });
    }
  }, []);

  useEffect(() => {
    void loadTasks();
  }, [loadTasks]);

  const activeTask = useMemo(() => {
    if (tasksState.status !== "loaded" || !activeId) return null;
    return tasksState.tasks.find((t) => t.id === activeId) ?? null;
  }, [tasksState, activeId]);

  const handleApprove = async (task: ForgeTask) => {
    try {
      const res = await fetch(`/api/forge/tasks/${task.id}/transition`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          from_lane: "production_review",
          to_lane: "done",
        }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as {
          error?: string;
          detail?: string;
        };
        throw new Error(data.detail ?? data.error ?? `status ${res.status}`);
      }
      setToast({ kind: "ok", message: `${task.title} → Done` });
      setTasksState((prev) => {
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
          {tasksState.status === "loaded" ? (
            <span style={{ marginLeft: 8, color: "var(--ink-faint)" }}>
              {tasksState.tasks.length}
            </span>
          ) : null}
        </div>
        <div style={{ flex: 1, overflow: "auto", padding: "8px 10px" }}>
          {tasksState.status === "loading" ? (
            <Empty>Loading…</Empty>
          ) : tasksState.status === "error" ? (
            <Empty>Couldn&rsquo;t load — {tasksState.message}</Empty>
          ) : tasksState.status === "empty" ? (
            <Empty>No tasks in {LANE_LABEL.production_review}.</Empty>
          ) : (
            tasksState.tasks.map((t) => (
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
          <PrPane
            key={activeTask.id}
            task={activeTask}
            onApprove={() => handleApprove(activeTask)}
          />
        ) : (
          <Empty>Select a task to review its PR.</Empty>
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
            background: "var(--ink)",
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

function PrPane({
  task,
  onApprove,
}: {
  task: ForgeTask;
  onApprove: () => void;
}) {
  const [embed, setEmbed] = useState<EmbedState>({ status: "idle" });

  useEffect(() => {
    let cancelled = false;
    setEmbed({ status: "loading" });
    (async () => {
      try {
        const res = await fetch(`/api/forge/tasks/${task.id}/pr`, {
          cache: "no-store",
        });
        if (!res.ok) {
          const data = (await res.json().catch(() => ({}))) as {
            error?: string;
            detail?: string;
          };
          throw new Error(data.detail ?? data.error ?? `status ${res.status}`);
        }
        const data = (await res.json()) as PrEmbed;
        if (!cancelled) setEmbed({ status: "loaded", embed: data });
      } catch (err) {
        if (!cancelled) {
          setEmbed({
            status: "error",
            message: err instanceof Error ? err.message : "failed to load PR",
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [task.id]);

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
            Production review
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
        </div>
        <button
          type="button"
          onClick={onApprove}
          disabled={embed.status !== "loaded"}
          style={buttonPrimaryStyle(embed.status !== "loaded")}
        >
          Approve → Done
        </button>
      </header>

      <div
        style={{
          flex: 1,
          overflow: "auto",
          padding: "20px 24px",
          display: "flex",
          flexDirection: "column",
          gap: 20,
        }}
      >
        {embed.status === "loading" || embed.status === "idle" ? (
          <Empty>Loading PR…</Empty>
        ) : embed.status === "error" ? (
          <ErrorBlock message={embed.message} />
        ) : (
          <PrEmbedView embed={embed.embed} />
        )}
      </div>
    </>
  );
}

function PrEmbedView({ embed }: { embed: PrEmbed }) {
  return (
    <>
      {embed.pr ? (
        <PrCard embed={embed} />
      ) : embed.pr_error ? (
        <ErrorBlock message={embed.pr_error} />
      ) : null}

      {embed.builder_summary ? (
        <BuilderSummary summary={embed.builder_summary} />
      ) : null}

      {embed.submitted_at ? (
        <div
          style={{
            fontFamily: "var(--font-plex-mono)",
            fontSize: 10,
            color: "var(--ink-faint)",
            letterSpacing: "0.12em",
          }}
        >
          Builder submitted {new Date(embed.submitted_at).toLocaleString()}
        </div>
      ) : null}
    </>
  );
}

function PrCard({ embed }: { embed: PrEmbed }) {
  const pr = embed.pr!;
  return (
    <div
      style={{
        border: "1px solid var(--rule)",
        background: "var(--panel)",
        padding: "16px 18px",
        display: "flex",
        flexDirection: "column",
        gap: 10,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <StateBadge state={pr.state} />
        <a
          href={pr.html_url}
          target="_blank"
          rel="noreferrer"
          style={{
            fontFamily: "var(--font-plex-mono)",
            fontSize: 11,
            color: "var(--ink-dim)",
            textDecoration: "none",
          }}
        >
          {embed.pr_url.replace("https://github.com/", "")}
          <span style={{ marginLeft: 4, opacity: 0.6 }}>↗</span>
        </a>
      </div>
      <div style={{ fontSize: 16, fontWeight: 500, color: "var(--ink)" }}>
        {pr.title}
      </div>
      <div
        style={{
          display: "flex",
          gap: 18,
          fontFamily: "var(--font-plex-mono)",
          fontSize: 11,
          color: "var(--ink-dim)",
          flexWrap: "wrap",
        }}
      >
        <span>
          <span style={{ color: "#2e7d32" }}>+{pr.additions}</span>
          {" / "}
          <span style={{ color: "#c62828" }}>−{pr.deletions}</span>
        </span>
        <span>
          {pr.changed_files} file{pr.changed_files === 1 ? "" : "s"}
        </span>
        <span>
          {pr.commits} commit{pr.commits === 1 ? "" : "s"}
        </span>
        <span>
          {pr.head_ref} → {pr.base_ref}
        </span>
        {pr.author ? <span>@{pr.author}</span> : null}
      </div>
      {pr.body ? (
        <pre
          style={{
            margin: 0,
            padding: "12px",
            background: "var(--panel-2)",
            border: "1px solid var(--rule)",
            fontFamily: "var(--font-plex-mono)",
            fontSize: 11,
            lineHeight: 1.5,
            color: "var(--ink-dim)",
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
            maxHeight: 260,
            overflow: "auto",
          }}
        >
          {pr.body}
        </pre>
      ) : null}
    </div>
  );
}

function StateBadge({ state }: { state: NonNullable<PrEmbed["pr"]>["state"] }) {
  const colour = {
    open: { bg: "#2e7d32", fg: "#ffffff" },
    merged: { bg: "#6f42c1", fg: "#ffffff" },
    closed: { bg: "#6e6e6e", fg: "#ffffff" },
    draft: { bg: "#6e6e6e", fg: "#ffffff" },
  }[state];
  return (
    <span
      style={{
        padding: "3px 8px",
        background: colour.bg,
        color: colour.fg,
        fontFamily: "var(--font-plex-mono)",
        fontSize: 10,
        letterSpacing: "0.12em",
        textTransform: "uppercase",
      }}
    >
      {state}
    </span>
  );
}

function BuilderSummary({
  summary,
}: {
  summary: NonNullable<PrEmbed["builder_summary"]>;
}) {
  const rows: Array<[string, string | undefined]> = [
    ["Files changed", summary.files_changed],
    ["Tests run", summary.tests_run],
    ["Risks", summary.risks],
    ["Follow-ups", summary.follow_ups_suggested],
  ];
  return (
    <div
      style={{
        border: "1px solid var(--rule)",
        padding: "16px 18px",
        display: "flex",
        flexDirection: "column",
        gap: 14,
      }}
    >
      <div
        style={{
          fontFamily: "var(--font-plex-mono)",
          fontSize: 10,
          letterSpacing: "0.16em",
          textTransform: "uppercase",
          color: "var(--ink-faint)",
        }}
      >
        Builder summary
        {summary.error ? (
          <span
            style={{
              marginLeft: 8,
              padding: "2px 6px",
              background: "#c62828",
              color: "#fff",
              fontSize: 9,
            }}
          >
            {summary.error}
          </span>
        ) : null}
      </div>
      {rows.map(([label, value]) =>
        value ? (
          <div key={label}>
            <div
              style={{
                fontFamily: "var(--font-plex-mono)",
                fontSize: 10,
                letterSpacing: "0.12em",
                color: "var(--ink-dim)",
                marginBottom: 4,
              }}
            >
              {label}
            </div>
            <div
              style={{
                fontSize: 13,
                color: "var(--ink)",
                lineHeight: 1.5,
                whiteSpace: "pre-wrap",
              }}
            >
              {value}
            </div>
          </div>
        ) : null,
      )}
    </div>
  );
}

function ErrorBlock({ message }: { message: string }) {
  return (
    <div
      style={{
        padding: "14px 16px",
        border: "1px solid var(--rule)",
        background: "var(--panel-2)",
        fontSize: 13,
        color: "var(--ink-dim)",
        lineHeight: 1.5,
      }}
    >
      {message}
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
