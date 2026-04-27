// Map workforce task data → per-agent sprite state.
//
// Each agent's state comes from their most recent task in the polled
// list:
//
//   running + tool maps to a station → at_station (sprite walks over)
//   running                          → working   (sprite at desk)
//   queued | blocked                 → waiting   (speech bubble)
//   completed within 30s             → complete  (green checkmark)
//   anything else / no task          → idle      (no overlay)
//
// at_station only fires when the running task's currentTool maps to a
// known station via tool-stations.ts. That keeps "the agent moved to
// the station" tied to actual tool telemetry instead of guessing
// from task descriptions.
//
// Brief-tool problem: cornerstone calls finish in <1s. A naive poll
// snapshot would almost never catch them in flight, so the sprite would
// never visibly walk anywhere. To smooth this out, callers may pass a
// `holds` map of agentId → { stationId, until } where we'll keep
// emitting at_station for that agent until `until`. This lets the
// shell layer (which sees raw poll snapshots tick-by-tick) keep a
// briefly-observed at_station visible for a couple of seconds even
// after the tool already returned.

import type { TaskSummary } from "@/lib/workforce/types";
import type { PendingApprovalDto } from "@/lib/workforce/approvals-client";
import { stationForTool, toolFamilyForTool } from "./tool-stations";
import type { AgentState } from "./types";

const COMPLETE_HOLD_MS = 30_000;

export interface AtStationHold {
  stationId: string;
  /** ms-since-epoch — sprite stays at the station until now() exceeds this. */
  until: number;
}

export function deriveAgentStates(
  tasks: TaskSummary[],
  now: number = Date.now(),
  holds: Record<string, AtStationHold> = {},
  pendingApprovals: PendingApprovalDto[] = [],
): Record<string, AgentState> {
  // Two passes:
  //  1. Group tasks by their lead agentId and compute a baseline
  //     state per lead from the most recent task.
  //  2. Layer in delegate at_station overrides — for each running
  //     task whose currentTool fires from a non-lead agent and maps
  //     to a station, send THAT agent to the station while leaving
  //     the lead's baseline alone.
  const byAgent = new Map<string, TaskSummary[]>();
  for (const task of tasks) {
    const list = byAgent.get(task.agentId);
    if (list) list.push(task);
    else byAgent.set(task.agentId, [task]);
  }

  const result: Record<string, AgentState> = {};
  for (const [agentId, agentTasks] of byAgent) {
    const sorted = [...agentTasks].sort(
      (a, b) =>
        new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime(),
    );
    result[agentId] = stateForTasks(sorted, now);
  }

  // Pass 2: delegate overrides. Walk every running task; if its
  // currentTool was fired by an agent who isn't the task's lead,
  // emit at_station for the firing agent. The lead's baseline
  // (already "working") stays put — they're back at their desk
  // while their delegate handles the call.
  for (const task of tasks) {
    if (task.state !== "running" || !task.currentTool) continue;
    const stationId = stationForTool(task.currentTool.name);
    if (!stationId) continue;
    const firingAgentId = task.currentTool.agentId;
    if (firingAgentId === task.agentId) continue;
    result[firingAgentId] = { kind: "at_station", stationId };
  }

  // Pass 3: apply client-side holds. If the shell observed an
  // at_station and the hold hasn't expired, force at_station even if
  // the task no longer reports an in-flight tool. This makes brief
  // cornerstone calls (<1s) visibly walk the agent over and back
  // instead of being lost between poll ticks.
  for (const [agentId, hold] of Object.entries(holds)) {
    if (now > hold.until) continue;
    result[agentId] = { kind: "at_station", stationId: hold.stationId };
  }

  // Pass 4: awaiting_approval overrides every other state. The agent's
  // dispatcher is parked on `await requestApproval(...)` — it can't be
  // working, walking, or thinking until an operator decides. We key by
  // (taskId, agentId) so a delegate awaiting approval gets the envelope
  // even when the lead is technically "running" the parent task.
  for (const approval of pendingApprovals) {
    result[approval.agentId] = {
      kind: "awaiting_approval",
      approvalId: approval.approvalId,
    };
  }
  return result;
}

function stateForTasks(tasks: TaskSummary[], now: number): AgentState {
  // An agent could have one running task and several historical tasks.
  // Running takes precedence — that's what the agent is "doing now."
  const running = tasks.find((t) => t.state === "running");
  if (running) {
    // If the lead themselves is the one firing the in-flight tool,
    // walk them to the station. Delegate-fired tools are handled in
    // the second pass of deriveAgentStates so the lead doesn't
    // hijack their delegate's at_station state.
    if (running.currentTool && running.currentTool.agentId === running.agentId) {
      const stationId = stationForTool(running.currentTool.name);
      if (stationId) return { kind: "at_station", stationId };
      // No station for this tool (delegate_task, native tools), but we
      // still know what *kind* of thing the agent is doing — surface
      // it as the working glyph so the overlay isn't a generic dot.
      const family = toolFamilyForTool(running.currentTool.name);
      return family ? { kind: "working", toolFamily: family } : { kind: "working" };
    }
    return { kind: "working" };
  }

  const pending = tasks.find(
    (t) => t.state === "queued" || t.state === "blocked",
  );
  if (pending) return { kind: "waiting" };

  // Only show "complete" briefly after a task finishes — otherwise an
  // agent that finished work an hour ago would still wear a green
  // checkmark, which reads as "currently complete" to a user glancing
  // at the office.
  const recentlyCompleted = tasks.find(
    (t) =>
      t.state === "completed" &&
      t.completedAt !== undefined &&
      now - new Date(t.completedAt).getTime() < COMPLETE_HOLD_MS,
  );
  if (recentlyCompleted) return { kind: "complete" };

  return { kind: "idle" };
}
