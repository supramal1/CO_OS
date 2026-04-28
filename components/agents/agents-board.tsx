"use client";

import { useEffect, useMemo, useState } from "react";
import type { DragEvent } from "react";
import {
  useAdminWorkspace,
  WorkspaceSelector,
} from "@/components/admin/workspace-selector";
import { CostConfirmDialog } from "@/components/forge/cost-confirm-dialog";
import {
  buildAgentsCostTransition,
  displayCostUsdForTask,
  shouldSkipAgentsCostConfirm,
  type AgentsCostTransition,
} from "@/lib/agents-cost";
import type { ForgeTask, BoardColumnId } from "@/lib/agents-types";
import {
  COLUMN_LABEL,
  COLUMN_ORDER,
  boardColumnForLane,
  resolveBoardDrop,
} from "@/lib/agents-types";
import {
  AGENTS_TASKS_POLL_MS,
  applyRealtimeTaskEvent,
  mergePolledTasks,
  shouldPollAgentsTasks,
} from "@/lib/agents-sync";
import type { CostRunRow } from "@/lib/cost-samples";
import { fetchUsdGbpRate, type FxRate } from "@/lib/fx-rate";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";
import { TaskCard } from "./task-card";
import { TaskDetail } from "./task-detail";
import { CreateTaskForm } from "./create-task-form";

type TasksState =
  | { status: "loading" }
  | { status: "loaded"; tasks: ForgeTask[]; refreshing?: boolean }
  | { status: "error"; message: string };

export function AgentsBoard() {
  const { selectedWorkspace } = useAdminWorkspace();
  const [state, setState] = useState<TasksState>({ status: "loading" });
  const [activeId, setActiveId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [toast, setToast] = useState<{
    kind: "error" | "success";
    message: string;
  } | null>(null);
  const [dragOver, setDragOver] = useState<BoardColumnId | null>(null);
  const [costRows, setCostRows] = useState<CostRunRow[] | null>(null);
  const [costRowsError, setCostRowsError] = useState(false);
  const [fxRate, setFxRate] = useState<FxRate | null>(null);
  const [pendingCost, setPendingCost] = useState<AgentsCostTransition | null>(
    null,
  );

  const namespaceQuery = selectedWorkspace
    ? `?namespace=${encodeURIComponent(selectedWorkspace)}`
    : "";

  useEffect(() => {
    if (!selectedWorkspace) return;
    let cancelled = false;

    const loadTasks = async (initial: boolean) => {
      if (initial) {
        setState({ status: "loading" });
      } else {
        setState((prev) =>
          prev.status === "loaded" ? { ...prev, refreshing: true } : prev,
        );
      }

      try {
        const res = await fetch(`/api/forge/tasks${namespaceQuery}`, {
          cache: "no-store",
        });
        if (!res.ok) {
          const data = (await res.json().catch(() => ({}))) as {
            error?: string;
          };
          throw new Error(data.error ?? `status ${res.status}`);
        }
        const tasks = (await res.json()) as ForgeTask[];
        if (cancelled) return;
        setState((prev) => {
          if (initial || prev.status !== "loaded") {
            return { status: "loaded", tasks, refreshing: false };
          }
          return {
            status: "loaded",
            tasks: mergePolledTasks(prev.tasks, tasks),
            refreshing: false,
          };
        });
      } catch (err) {
        if (cancelled) return;
        if (initial) {
          setState({
            status: "error",
            message: err instanceof Error ? err.message : "failed to load",
          });
          return;
        }
        setState((prev) =>
          prev.status === "loaded" ? { ...prev, refreshing: false } : prev,
        );
      }
    };

    void loadTasks(true);

    const refreshIfVisible = () => {
      if (shouldPollAgentsTasks(document.visibilityState)) {
        void loadTasks(false);
      }
    };
    const pollId = window.setInterval(
      refreshIfVisible,
      AGENTS_TASKS_POLL_MS,
    );
    window.addEventListener("focus", refreshIfVisible);
    document.addEventListener("visibilitychange", refreshIfVisible);

    return () => {
      cancelled = true;
      window.clearInterval(pollId);
      window.removeEventListener("focus", refreshIfVisible);
      document.removeEventListener("visibilitychange", refreshIfVisible);
    };
  }, [namespaceQuery, selectedWorkspace]);

  useEffect(() => {
    if (!selectedWorkspace) return;
    const sb = getSupabaseBrowserClient();
    if (!sb) return;

    const channel = sb
      .channel(`agents-tasks-realtime-${selectedWorkspace}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "forge_tasks",
          filter: `namespace=eq.${selectedWorkspace}`,
        },
        (payload) => {
          const row = (payload.new ?? payload.old) as ForgeTask | null;
          if (!row?.id) return;
          setState((prev) => {
            if (prev.status !== "loaded") return prev;
            return {
              ...prev,
              tasks: applyRealtimeTaskEvent(
                prev.tasks,
                row,
                payload.eventType,
              ),
            };
          });
        },
      )
      .subscribe();

    return () => {
      void sb.removeChannel(channel);
    };
  }, [selectedWorkspace]);

  useEffect(() => {
    let cancelled = false;
    fetchUsdGbpRate().then((rate) => {
      if (!cancelled && rate) setFxRate(rate);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const sb = getSupabaseBrowserClient();
    if (!sb) {
      setCostRowsError(true);
      return;
    }
    (async () => {
      const { data, error } = await sb
        .from("forge_task_runs")
        .select("task_id, run_type, actual_cost_usd")
        .not("actual_cost_usd", "is", null)
        .gt("actual_cost_usd", 0)
        .limit(2000);
      if (cancelled) return;
      if (error || !data) {
        setCostRowsError(true);
        return;
      }
      setCostRows(data as CostRunRow[]);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const grouped = useMemo(() => {
    const groups: Record<BoardColumnId, ForgeTask[]> = {
      backlog: [],
      in_progress: [],
      review: [],
      done: [],
    };
    if (state.status === "loaded") {
      const sorted = [...state.tasks].sort((a, b) => {
        if (b.priority !== a.priority) return b.priority - a.priority;
        return b.updated_at.localeCompare(a.updated_at);
      });
      for (const task of sorted) {
        groups[boardColumnForLane(task.lane)].push(task);
      }
    }
    return groups;
  }, [state]);

  const activeTask =
    state.status === "loaded"
      ? state.tasks.find((t) => t.id === activeId) ?? null
      : null;
  const isRefreshing = state.status === "loaded" && state.refreshing === true;

  const applyTaskUpdate = (next: ForgeTask) => {
    setState((s) => {
      if (s.status !== "loaded") return s;
      return {
        status: "loaded",
        tasks: s.tasks.map((t) => (t.id === next.id ? next : t)),
      };
    });
  };

  const runTransition = async (
    current: ForgeTask,
    fromLane: ForgeTask["lane"],
    toLane: ForgeTask["lane"],
  ) => {
    const optimistic: ForgeTask = {
      ...current,
      lane: toLane,
      updated_at: new Date().toISOString(),
    };
    applyTaskUpdate(optimistic);

    try {
      const res = await fetch(
        `/api/forge/tasks/${current.id}/transition${namespaceQuery}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            from_lane: fromLane,
            to_lane: toLane,
          }),
        },
      );
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as {
          error?: string;
          detail?: string;
        };
        throw new Error(data.detail ?? data.error ?? `status ${res.status}`);
      }
    } catch (err) {
      applyTaskUpdate(current);
      setToast({
        kind: "error",
        message: err instanceof Error ? err.message : "transition failed",
      });
    }
  };

  const handleDrop = async (column: BoardColumnId, taskId: string) => {
    setDragOver(null);
    if (state.status !== "loaded") return;
    const current = state.tasks.find((t) => t.id === taskId);
    if (!current) return;
    const resolution = resolveBoardDrop(current.lane, column);
    if (resolution.type === "noop") return;
    if (resolution.type === "blocked") {
      setToast({ kind: "error", message: resolution.message });
      return;
    }

    if (shouldSkipAgentsCostConfirm(resolution.fromLane, resolution.toLane)) {
      await runTransition(current, resolution.fromLane, resolution.toLane);
      return;
    }

    setPendingCost(
      buildAgentsCostTransition({
        task: current,
        from: resolution.fromLane,
        to: resolution.toLane,
        costRows,
        costRowsError,
      }),
    );
  };

  return (
    <div
      style={{
        height: "calc(100vh - var(--shell-h))",
        display: "grid",
        gridTemplateColumns: activeTask ? "minmax(0, 1fr) 420px" : "1fr",
        minHeight: 0,
      }}
    >
      <section
        style={{
          display: "flex",
          flexDirection: "column",
          minHeight: 0,
          borderRight: activeTask ? "1px solid var(--rule)" : "none",
        }}
      >
        <header
          style={{
            padding: "20px 28px 16px",
            borderBottom: "1px solid var(--rule)",
            display: "flex",
            alignItems: "center",
            gap: 12,
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
            Agents · tasks
          </div>
          <div style={{ flex: 1 }} />
          <WorkspaceSelector />
          {isRefreshing ? (
            <span
              aria-label="Refreshing tasks"
              style={{
                fontFamily: "var(--font-plex-mono)",
                fontSize: 10,
                letterSpacing: "0.12em",
                textTransform: "uppercase",
                color: "var(--ink-faint)",
              }}
            >
              Syncing…
            </span>
          ) : null}
          <button
            type="button"
            onClick={() => setShowCreate(true)}
            style={{
              fontFamily: "var(--font-plex-mono)",
              fontSize: 11,
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              padding: "6px 12px",
              background: "var(--ink)",
              color: "var(--panel)",
              border: "1px solid var(--ink)",
              cursor: "pointer",
            }}
          >
            New task
          </button>
        </header>

        {state.status === "loading" ? (
          <Empty>Loading tasks…</Empty>
        ) : state.status === "error" ? (
          <Empty>Couldn&rsquo;t load — {state.message}</Empty>
        ) : (
          <div
            style={{
              flex: 1,
              display: "grid",
              gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
              gap: 0,
              minHeight: 0,
            }}
          >
            {COLUMN_ORDER.map((col) => (
              <Column
                key={col}
                columnId={col}
                tasks={grouped[col]}
                costRows={costRows}
                activeId={activeId}
                isDragOver={dragOver === col}
                onSelect={setActiveId}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragOver(col);
                }}
                onDragLeave={() => setDragOver(null)}
                onDrop={(e) => {
                  const taskId = e.dataTransfer.getData("text/task-id");
                  if (taskId) handleDrop(col, taskId);
                }}
              />
            ))}
          </div>
        )}
      </section>

      {activeTask ? (
        <aside
          style={{
            background: "var(--panel)",
            minHeight: 0,
            overflow: "hidden",
          }}
        >
          <TaskDetail
            task={activeTask}
            namespace={selectedWorkspace}
            costUsd={displayCostUsdForTask(activeTask, costRows)}
            onUpdated={applyTaskUpdate}
            onDeleted={(id) => {
              setState((s) => {
                if (s.status !== "loaded") return s;
                return {
                  status: "loaded",
                  tasks: s.tasks.filter((t) => t.id !== id),
                };
              });
              setActiveId(null);
            }}
            onSuccess={(message) => setToast({ kind: "success", message })}
            onError={(message) => setToast({ kind: "error", message })}
            onClose={() => setActiveId(null)}
          />
        </aside>
      ) : null}

      {showCreate ? (
        <CreateTaskForm
          namespace={selectedWorkspace}
          onCreated={(task) => {
            setState((s) => {
              if (s.status !== "loaded") return s;
              return { status: "loaded", tasks: [task, ...s.tasks] };
            });
          }}
          onError={(message) => setToast({ kind: "error", message })}
          onClose={() => setShowCreate(false)}
        />
      ) : null}

      {pendingCost ? (
        <CostConfirmDialog
          from={pendingCost.from}
          to={pendingCost.to}
          taskTitle={pendingCost.taskTitle}
          estimate={pendingCost.estimate}
          estimateError={pendingCost.estimateError}
          fxRate={fxRate}
          onCancel={() => setPendingCost(null)}
          onConfirm={() => {
            const pending = pendingCost;
            setPendingCost(null);
            if (state.status !== "loaded") return;
            const current = state.tasks.find((t) => t.id === pending.taskId);
            if (!current) return;
            void runTransition(current, pending.from, pending.to);
          }}
        />
      ) : null}

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
            border:
              toast.kind === "success"
                ? "1px solid rgba(58, 125, 68, 0.9)"
                : "1px solid rgba(192, 57, 43, 0.9)",
            fontFamily: "var(--font-plex-sans)",
            fontSize: 13,
            zIndex: 30,
            cursor: "pointer",
          }}
        >
          {toast.message}
        </div>
      ) : null}
    </div>
  );
}

function Column({
  columnId,
  tasks,
  costRows,
  activeId,
  isDragOver,
  onSelect,
  onDragOver,
  onDragLeave,
  onDrop,
}: {
  columnId: BoardColumnId;
  tasks: ForgeTask[];
  costRows: CostRunRow[] | null;
  activeId: string | null;
  isDragOver: boolean;
  onSelect: (id: string) => void;
  onDragOver: (e: DragEvent<HTMLDivElement>) => void;
  onDragLeave: () => void;
  onDrop: (e: DragEvent<HTMLDivElement>) => void;
}) {
  return (
    <div
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      style={{
        display: "flex",
        flexDirection: "column",
        borderRight: "1px solid var(--rule)",
        background: isDragOver ? "var(--panel-2)" : "transparent",
        minHeight: 0,
        transition: "background 120ms ease",
      }}
    >
      <div
        style={{
          padding: "14px 16px",
          borderBottom: "1px solid var(--rule)",
          display: "flex",
          alignItems: "center",
          gap: 8,
        }}
      >
        <span
          style={{
            fontFamily: "var(--font-plex-mono)",
            fontSize: 10,
            letterSpacing: "0.16em",
            textTransform: "uppercase",
            color: "var(--ink-dim)",
          }}
        >
          {COLUMN_LABEL[columnId]}
        </span>
        <span
          style={{
            fontFamily: "var(--font-plex-mono)",
            fontSize: 10,
            color: "var(--ink-faint)",
          }}
        >
          {tasks.length}
        </span>
      </div>
      <div
        style={{
          flex: 1,
          overflow: "auto",
          padding: 12,
          display: "flex",
          flexDirection: "column",
          gap: 8,
        }}
      >
        {tasks.length === 0 ? (
          <div
            style={{
              fontFamily: "var(--font-plex-sans)",
              fontSize: 12,
              color: "var(--ink-faint)",
              textAlign: "center",
              padding: "20px 8px",
            }}
          >
            —
          </div>
        ) : (
          tasks.map((task) => (
            <TaskCard
              key={task.id}
              task={task}
              costUsd={displayCostUsdForTask(task, costRows)}
              active={task.id === activeId}
              onSelect={() => onSelect(task.id)}
              onDragStart={(e) => {
                e.dataTransfer.setData("text/task-id", task.id);
                e.dataTransfer.effectAllowed = "move";
              }}
            />
          ))
        )}
      </div>
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
