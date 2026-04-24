"use client";

import { useEffect, useMemo, useState } from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import type { ForgeLane, ForgeTask } from "@/lib/agents-types";
import {
  LANE_LABEL,
  LANE_ORDER,
  isAllowedTransition,
} from "@/lib/agents-types";

type TasksState =
  | { status: "loading" }
  | { status: "loaded"; tasks: ForgeTask[] }
  | { status: "error"; message: string };

export function ForgeKanban() {
  const [state, setState] = useState<TasksState>({ status: "loading" });
  const [toast, setToast] = useState<{ kind: "error"; message: string } | null>(
    null,
  );
  const [activeId, setActiveId] = useState<string | null>(null);

  // PointerSensor with a small activation distance prevents click-vs-drag
  // ambiguity — clicking a card shouldn't initiate a drag, only a real
  // pointer move past 5px should.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/forge/tasks", { cache: "no-store" });
        if (!res.ok) {
          const data = (await res.json().catch(() => ({}))) as {
            error?: string;
          };
          throw new Error(data.error ?? `status ${res.status}`);
        }
        const tasks = (await res.json()) as ForgeTask[];
        if (!cancelled) setState({ status: "loaded", tasks });
      } catch (err) {
        if (!cancelled) {
          setState({
            status: "error",
            message: err instanceof Error ? err.message : "failed to load",
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const grouped = useMemo(() => {
    const groups: Record<ForgeLane, ForgeTask[]> = {
      backlog: [],
      research: [],
      research_review: [],
      production: [],
      production_review: [],
      done: [],
    };
    if (state.status !== "loaded") return groups;
    // Priority desc, then most recently updated first. Stable ordering
    // keeps the card the user just dragged from sliding under its peers.
    const sorted = [...state.tasks].sort((a, b) => {
      if (b.priority !== a.priority) return b.priority - a.priority;
      return b.updated_at.localeCompare(a.updated_at);
    });
    for (const task of sorted) {
      const lane = normaliseLane(task.lane);
      groups[lane].push(task);
    }
    return groups;
  }, [state]);

  const applyLane = (taskId: string, lane: ForgeLane) => {
    setState((s) => {
      if (s.status !== "loaded") return s;
      return {
        status: "loaded",
        tasks: s.tasks.map((t) =>
          t.id === taskId ? { ...t, lane, updated_at: new Date().toISOString() } : t,
        ),
      };
    });
  };

  const handleDragStart = (event: DragStartEvent) => {
    setActiveId(String(event.active.id));
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    setActiveId(null);
    const taskId = String(event.active.id);
    const overLane = event.over?.id as ForgeLane | undefined;
    if (!overLane || state.status !== "loaded") return;
    const task = state.tasks.find((t) => t.id === taskId);
    if (!task) return;
    const fromLane = normaliseLane(task.lane);
    if (fromLane === overLane) return;
    if (!isAllowedTransition(fromLane, overLane)) {
      setToast({
        kind: "error",
        message: `Can't move from ${LANE_LABEL[fromLane]} → ${LANE_LABEL[overLane]}. Drags only open research (Backlog→Research), production (Research Review→Production), or close the task (Production Review→Done).`,
      });
      return;
    }

    // Optimistic: move the card now, revert if the transition API fails.
    // The Realtime stream (KR-4) will re-converge the lane to whatever the
    // backend ends up writing — a lane of research may flip to
    // research_review within a few minutes as PM finishes scoping.
    applyLane(taskId, overLane);
    try {
      const res = await fetch(`/api/forge/tasks/${taskId}/transition`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ from_lane: fromLane, to_lane: overLane }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as {
          error?: string;
          detail?: string;
        };
        throw new Error(data.detail ?? data.error ?? `status ${res.status}`);
      }
    } catch (err) {
      applyLane(taskId, fromLane);
      setToast({
        kind: "error",
        message: err instanceof Error ? err.message : "transition failed",
      });
    }
  };

  return (
    <div
      style={{
        height: "calc(100vh - var(--shell-h) - var(--forge-subnav-h, 44px))",
        display: "flex",
        flexDirection: "column",
        minHeight: 0,
      }}
    >
      {state.status === "loading" ? (
        <Empty>Loading tasks…</Empty>
      ) : state.status === "error" ? (
        <Empty>Couldn&rsquo;t load — {state.message}</Empty>
      ) : (
        <DndContext
          sensors={sensors}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
          onDragCancel={() => setActiveId(null)}
        >
          <div
            style={{
              flex: 1,
              display: "grid",
              gridTemplateColumns: "repeat(6, minmax(0, 1fr))",
              gap: 0,
              minHeight: 0,
            }}
          >
            {LANE_ORDER.map((lane) => (
              <LaneColumn
                key={lane}
                lane={lane}
                tasks={grouped[lane]}
                activeId={activeId}
              />
            ))}
          </div>
          {/* Portaled clone — renders outside the per-column scroll
              container so it floats above neighbouring lanes during drag. */}
          <DragOverlay dropAnimation={null}>
            {activeId && state.status === "loaded"
              ? (() => {
                  const t = state.tasks.find((x) => x.id === activeId);
                  return t ? <KanbanCardPresentational task={t} dragging /> : null;
                })()
              : null}
          </DragOverlay>
        </DndContext>
      )}

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

function LaneColumn({
  lane,
  tasks,
  activeId,
}: {
  lane: ForgeLane;
  tasks: ForgeTask[];
  activeId: string | null;
}) {
  const { isOver, setNodeRef } = useDroppable({ id: lane });
  return (
    <div
      ref={setNodeRef}
      style={{
        display: "flex",
        flexDirection: "column",
        borderRight: "1px solid var(--rule)",
        background: isOver ? "var(--panel-2)" : "transparent",
        minHeight: 0,
        transition: "background 120ms ease",
      }}
    >
      <div
        style={{
          padding: "14px 14px",
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
          {LANE_LABEL[lane]}
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
          padding: 10,
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
            <KanbanCard key={task.id} task={task} hidden={task.id === activeId} />
          ))
        )}
      </div>
    </div>
  );
}

function KanbanCard({ task, hidden }: { task: ForgeTask; hidden: boolean }) {
  const { attributes, listeners, setNodeRef } = useDraggable({ id: task.id });
  // While dragging, the source card leaves a transparent placeholder so the
  // column doesn't collapse. The floating clone is rendered by DragOverlay.
  const style: React.CSSProperties = {
    visibility: hidden ? "hidden" : "visible",
    cursor: "grab",
    touchAction: "none",
  };
  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
      <KanbanCardPresentational task={task} />
    </div>
  );
}

function KanbanCardPresentational({
  task,
  dragging = false,
}: {
  task: ForgeTask;
  dragging?: boolean;
}) {
  const style: React.CSSProperties = {
    padding: "10px 12px",
    background: "var(--panel)",
    border: "1px solid var(--rule)",
    fontFamily: "var(--font-plex-sans)",
    fontSize: 13,
    lineHeight: 1.35,
    color: "var(--ink)",
    userSelect: "none",
    cursor: dragging ? "grabbing" : "grab",
    boxShadow: dragging
      ? "0 10px 24px rgba(0, 0, 0, 0.25), 0 2px 4px rgba(0, 0, 0, 0.15)"
      : "none",
    transform: dragging ? "rotate(1.5deg)" : undefined,
  };
  return (
    <div style={style}>
      <div style={{ fontWeight: 500 }}>{task.title}</div>
      {task.description ? (
        <div
          style={{
            marginTop: 4,
            color: "var(--ink-dim)",
            fontSize: 12,
            overflow: "hidden",
            display: "-webkit-box",
            WebkitBoxOrient: "vertical",
            WebkitLineClamp: 2,
          }}
        >
          {task.description}
        </div>
      ) : null}
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

// Defensive — older rows pre-migration 047 may have null lane or a
// legacy value. Surface those as backlog rather than dropping the card.
function normaliseLane(lane: string | null | undefined): ForgeLane {
  const candidates = new Set(LANE_ORDER);
  if (lane && candidates.has(lane as ForgeLane)) return lane as ForgeLane;
  return "backlog";
}
