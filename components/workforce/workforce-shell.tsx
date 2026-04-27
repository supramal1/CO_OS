"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { PublicAgent, TaskSummary } from "@/lib/workforce/types";
import {
  fetchPendingApprovals,
  type PendingApprovalDto,
} from "@/lib/workforce/approvals-client";
import { TaskInput } from "./task-input";
import { RecentTasksList } from "./recent-tasks-list";
import { TaskConversationPane } from "./task-conversation-pane";
import { AgentPanel } from "./agent-panel";
import { ApprovalModal } from "./approval-modal";
import { WorkforceCostBand } from "./cost-observability";
import { PixelOffice } from "./office/pixel-office";
import { deriveAgentStates, type AtStationHold } from "./office/derive-states";
import { stationForTool } from "./office/tool-stations";
import { workforceCostSummary } from "@/lib/workforce/cost-observability";

// How long after a tool call appears in a poll snapshot we keep the
// sprite at the station, even if the next snapshot shows no in-flight
// tool. Two seconds is enough for the CSS slide (900ms) + a beat at
// the station + the slide back, so brief cornerstone calls actually
// read as "walked over and back" instead of being invisible.
const AT_STATION_HOLD_MS = 2500;
const POLL_INTERVAL_MS = 1500;

export function WorkforceShell() {
  const [agents, setAgents] = useState<PublicAgent[]>([]);
  const [tasks, setTasks] = useState<TaskSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // null = "compose" mode; a taskId = inspecting that task in the pane.
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  // null = no agent panel; an agentId = the panel is anchored to that
  // sprite. Mutually exclusive with selectedTaskId — picking either one
  // clears the other so the right pane has exactly one mode.
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  // Pre-fills the dispatch form with a target agent. Set when the user
  // clicks "+ Dispatch to X" in the agent panel; cleared when compose
  // mode mounts so a fresh "+ New task" doesn't re-pick the last agent.
  const [composeAgentId, setComposeAgentId] = useState<string | null>(null);
  // Per-agent at_station hold map. Refreshed on every render via the
  // tasks effect: when we observe a new tool call, we stamp until=now+
  // AT_STATION_HOLD_MS so the sprite stays parked there even after the
  // tool returns. Held in a ref because it's a transient view-only
  // ledger — we don't want a render loop on tick changes.
  const holdsRef = useRef<Record<string, AtStationHold>>({});
  // Force re-render when holds change so agentStates picks up the new
  // hold. Tied to a dummy counter so React knows to re-run useMemo.
  const [holdsTick, setHoldsTick] = useState(0);
  // Approval inbox state — pending list polled separately from tasks
  // so a slow tasks fetch doesn't delay the badge from appearing.
  const [approvals, setApprovals] = useState<PendingApprovalDto[]>([]);
  const [inboxOpen, setInboxOpen] = useState(false);

  async function refreshApprovals() {
    try {
      const list = await fetchPendingApprovals();
      setApprovals(list);
    } catch {
      // Inbox is best-effort; the office stays usable without it. We
      // keep the previous list rather than clearing on transient
      // failures so a single dropped poll doesn't blank the badge.
    }
  }

  async function refresh() {
    try {
      const [agentsRes, tasksRes] = await Promise.all([
        fetch("/api/workforce/agents", { cache: "no-store" }),
        fetch("/api/workforce/tasks?limit=50", { cache: "no-store" }),
      ]);
      if (!agentsRes.ok || !tasksRes.ok) {
        setError(`agents=${agentsRes.status} tasks=${tasksRes.status}`);
      } else {
        const a = await agentsRes.json();
        const t = await tasksRes.json();
        setAgents(a.agents ?? []);
        setTasks(t.tasks ?? []);
        setError(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
    const id = setInterval(refresh, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, []);

  // Approval inbox poll — runs alongside the tasks/agents poll so the
  // badge appears within ~1.5s of an agent firing a destructive tool,
  // and refreshes during the modal so a parallel resolve in another
  // tab clears the row here too.
  useEffect(() => {
    void refreshApprovals();
    const id = setInterval(refreshApprovals, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, []);

  // Stamp a hold whenever we see a tool that maps to a station. We
  // walk every running task's currentTool — both lead-fired and
  // delegate-fired — and refresh the hold for whoever is firing.
  // The hold is bumped on each observation, so a long-running tool
  // (Margaret's web_search) keeps her parked at research; a short
  // one (Ada's save_conversation) parks her for AT_STATION_HOLD_MS
  // even after a single observation.
  useEffect(() => {
    let touched = false;
    const now = Date.now();
    for (const t of tasks) {
      if (t.state !== "running" || !t.currentTool) continue;
      const stationId = stationForTool(t.currentTool.name);
      if (!stationId) continue;
      const firingAgentId = t.currentTool.agentId;
      const existing = holdsRef.current[firingAgentId];
      if (
        !existing ||
        existing.stationId !== stationId ||
        existing.until < now + AT_STATION_HOLD_MS
      ) {
        holdsRef.current = {
          ...holdsRef.current,
          [firingAgentId]: { stationId, until: now + AT_STATION_HOLD_MS },
        };
        touched = true;
      }
    }
    if (touched) setHoldsTick((n) => n + 1);
  }, [tasks]);

  // Re-derives every poll cycle (new tasks array). The "complete" hold
  // window is enforced by deriveAgentStates against Date.now(), so
  // green checkmarks fade back to idle on the next poll after 30s.
  // The at_station hold map keeps brief tool calls visible.
  const agentStates = useMemo(
    () =>
      deriveAgentStates(tasks, Date.now(), holdsRef.current, approvals),
    // holdsTick is intentionally in deps: when a new hold is stamped,
    // we want this memo to recompute even if `tasks` reference hasn't
    // changed yet. approvals is in deps so a new pending approval flips
    // the affected sprite's state to awaiting_approval immediately.
    [tasks, holdsTick, approvals],
  );

  // Tick the holds map so expired entries fall off. Without this, the
  // hold would only clear on the next poll snapshot — which is fine
  // for correctness but makes the sprite linger at the station an
  // extra ~1.5s past the hold window. A 500ms heartbeat keeps the
  // visual snappy without flooding renders.
  useEffect(() => {
    const id = setInterval(() => {
      const now = Date.now();
      let cleaned = false;
      const next: Record<string, AtStationHold> = {};
      for (const [k, v] of Object.entries(holdsRef.current)) {
        if (v.until > now) next[k] = v;
        else cleaned = true;
      }
      if (cleaned) {
        holdsRef.current = next;
        setHoldsTick((n) => n + 1);
      }
    }, 500);
    return () => clearInterval(id);
  }, []);

  async function handleDispatch(input: {
    agentId: string;
    description: string;
    targetWorkspace?: string;
    maxCostUsd?: number;
    context?: string;
  }): Promise<{ taskId: string }> {
    const res = await fetch("/api/workforce/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`HTTP ${res.status}: ${text}`);
    }
    const body = (await res.json()) as { taskId: string };
    // Refresh the roster so the new task lands in the rail, then
    // auto-select it so the user can watch the conversation unfold
    // without clicking around.
    await refresh();
    setSelectedTaskId(body.taskId);
    return body;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", minHeight: 0 }}>
      <section
        aria-label="Pixel office"
        style={{
          borderBottom: "1px solid var(--rule)",
          padding: "20px 28px 8px",
        }}
      >
        <SectionHeader>Office</SectionHeader>
        <PixelOffice
          agentStates={agentStates}
          selectedAgentId={selectedAgentId}
          pendingApprovalCount={approvals.length}
          onInboxClick={() => setInboxOpen(true)}
          onAgentClick={(agentId) => {
            // Clicking the same sprite twice closes the panel — reads
            // as "deselect" not "re-confirm." Otherwise toggle: open
            // panel, close any task pane, clear pending compose target.
            setSelectedAgentId((current) => (current === agentId ? null : agentId));
            setSelectedTaskId(null);
            setComposeAgentId(null);
          }}
        />
        <LiveStatusStrip tasks={tasks} agents={agents} />
        <ApprovalModal
          open={inboxOpen}
          approvals={approvals}
          agents={agents}
          onClose={() => setInboxOpen(false)}
          onResolved={() => {
            // After every resolve, refresh both the approvals list and
            // the task list so the sprite transitions out of awaiting_
            // approval and the office reflects the agent's next move
            // without waiting for the 1.5s poll tick.
            void refreshApprovals();
            void refresh();
          }}
        />
      </section>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(260px, 320px) minmax(0, 1fr)",
          gap: 24,
          padding: 28,
          minHeight: 0,
        }}
      >
        <WorkforceCostBand tasks={tasks} />
        <aside style={{ display: "flex", flexDirection: "column", gap: 16, minWidth: 0 }}>
          <button
            type="button"
            onClick={() => {
              setSelectedTaskId(null);
              setSelectedAgentId(null);
              setComposeAgentId(null);
            }}
            style={newTaskButtonStyle(
              selectedTaskId === null && selectedAgentId === null,
            )}
          >
            + New task
          </button>
          <SectionHeader>Recent</SectionHeader>
          {loading ? (
            <Note>Loading roster…</Note>
          ) : error ? (
            <Note tone="error">Failed to load: {error}</Note>
          ) : (
            <RecentTasksList
              tasks={tasks.filter((t) => !t.parentTaskId)}
              selectedTaskId={selectedTaskId}
              onSelect={(id) => {
                setSelectedTaskId(id);
                setSelectedAgentId(null);
              }}
            />
          )}
        </aside>
        <section style={{ minWidth: 0, display: "flex", flexDirection: "column" }}>
          {selectedAgentId !== null ? (
            (() => {
              const agent = agents.find((a) => a.id === selectedAgentId);
              if (!agent) {
                // Agent vanished from the roster (template change, race
                // on initial load). Fall back to compose silently.
                return (
                  <Note>Agent {selectedAgentId} not found in roster.</Note>
                );
              }
              return (
                <AgentPanel
                  agent={agent}
                  agentState={agentStates[agent.id]}
                  tasks={tasks}
                  onSelectTask={(taskId) => {
                    setSelectedTaskId(taskId);
                    setSelectedAgentId(null);
                  }}
                  onClose={() => setSelectedAgentId(null)}
                  onComposeForAgent={(agentId) => {
                    setComposeAgentId(agentId);
                    setSelectedAgentId(null);
                    setSelectedTaskId(null);
                  }}
                />
              );
            })()
          ) : selectedTaskId === null ? (
            <>
              <SectionHeader>Dispatch</SectionHeader>
              {loading ? (
                <Note>Loading roster…</Note>
              ) : error ? (
                <Note tone="error">Failed to load: {error}</Note>
              ) : (
                <TaskInput
                  // key remounts the form when the prefill changes, so
                  // the internal agentId state picks up the new default.
                  key={composeAgentId ?? "default"}
                  agents={agents}
                  defaultAgentId={composeAgentId ?? undefined}
                  onDispatch={handleDispatch}
                />
              )}
            </>
          ) : (
            // key forces a fresh mount when switching tasks — simpler
            // than threading "did the id change?" through every effect.
            <TaskConversationPane
              key={selectedTaskId}
              taskId={selectedTaskId}
              onReply={handleDispatch}
            />
          )}
        </section>
      </div>
    </div>
  );
}

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <h2
      style={{
        margin: 0,
        marginBottom: 16,
        fontFamily: "var(--font-plex-mono)",
        fontSize: 11,
        letterSpacing: "0.18em",
        textTransform: "uppercase",
        color: "var(--ink-dim)",
      }}
    >
      {children}
    </h2>
  );
}

function Note({
  children,
  tone = "default",
}: {
  children: React.ReactNode;
  tone?: "default" | "error";
}) {
  return (
    <p
      style={{
        margin: 0,
        fontSize: 13,
        color: tone === "error" ? "var(--c-forge)" : "var(--ink-dim)",
      }}
    >
      {children}
    </p>
  );
}

// Diagnostic + telemetry strip: shows what each running task is doing
// right now, including which agent is firing the in-flight tool. If
// this strip stays empty during a known-running task, currentTool
// isn't being populated server-side — that's the bug, not the office
// rendering. Brief tool calls (<1s) often miss poll snapshots, so
// emptiness here during a long span is meaningful but emptiness
// during a short span is not.
function LiveStatusStrip({
  tasks,
  agents,
}: {
  tasks: TaskSummary[];
  agents: PublicAgent[];
}) {
  const running = tasks.filter((t) => t.state === "running");
  const rootTasks = tasks.filter((t) => !t.parentTaskId);
  const cost = workforceCostSummary(rootTasks);
  const nameById = new Map(agents.map((a) => [a.id, a.name]));
  return (
    <div
      style={{
        marginTop: 12,
        padding: "8px 10px",
        background: "var(--panel-2, rgba(255,255,255,0.04))",
        border: "1px solid var(--rule)",
        display: "flex",
        flexWrap: "wrap",
        gap: 16,
        alignItems: "center",
        fontFamily: "var(--font-plex-mono)",
        fontSize: 11,
        letterSpacing: "0.08em",
        color: "var(--ink-dim)",
        minHeight: 28,
      }}
    >
      <span
        style={{
          fontSize: 9,
          letterSpacing: "0.18em",
          textTransform: "uppercase",
          color: "var(--ink-faint)",
        }}
      >
        Live
      </span>
      <span style={{ color: cost.overrunCount > 0 ? "var(--c-forge)" : "var(--ink-dim)" }}>
        running ${cost.runningUsd.toFixed(4)}
      </span>
      {running.length === 0 ? (
        <span style={{ color: "var(--ink-faint)" }}>no running tasks</span>
      ) : (
        running.map((t) => {
          const lead = nameById.get(t.agentId) ?? t.agentId;
          const tool = t.currentTool;
          const firing = tool
            ? nameById.get(tool.agentId) ?? tool.agentId
            : null;
          const dbg = t._debug;
          return (
            <span key={t.taskId} style={{ whiteSpace: "nowrap" }}>
              <strong style={{ color: "var(--ink)" }}>{lead}</strong>
              {" · "}
              {tool ? (
                <span style={{ color: "var(--ink)" }}>
                  {firing} → {tool.name}
                </span>
              ) : (
                <span style={{ color: "var(--ink-faint)" }}>thinking…</span>
              )}
              {dbg ? (
                <span
                  style={{
                    marginLeft: 8,
                    color: dbg.inMemory
                      ? "var(--ink-faint)"
                      : "var(--c-forge)",
                    fontSize: 9,
                  }}
                >
                  [{dbg.inMemory ? "mem" : "db"} · ev {dbg.eventCount} · tc{" "}
                  {dbg.toolCalledCount}/{dbg.toolReturnedCount}
                  {dbg.latestToolCalled ? ` · last ${dbg.latestToolCalled}` : ""}]
                </span>
              ) : null}
            </span>
          );
        })
      )}
    </div>
  );
}

function newTaskButtonStyle(active: boolean): React.CSSProperties {
  return {
    padding: "10px 14px",
    background: active ? "var(--ink)" : "transparent",
    color: active ? "var(--panel)" : "var(--ink)",
    border: `1px solid var(--ink)`,
    fontFamily: "var(--font-plex-mono)",
    fontSize: 11,
    letterSpacing: "0.14em",
    textTransform: "uppercase",
    cursor: "pointer",
    textAlign: "left",
  };
}
