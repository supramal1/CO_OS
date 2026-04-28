import { describe, expect, it } from "vitest";
import {
  buildGlobalBriefStats,
  groupForgeTasksByLane,
} from "@/lib/forge-global-view";
import type { ForgeTask } from "@/lib/agents-types";
import type { Brief } from "@/lib/forge-types";

function task(overrides: Partial<ForgeTask>): ForgeTask {
  return {
    id: "task-default",
    title: "Task",
    description: null,
    lane: "backlog",
    status: "submitted",
    agent_id: null,
    priority: 0,
    creator_type: null,
    creator_id: null,
    assignee_type: null,
    assignee_id: null,
    metadata: null,
    namespace: "default",
    created_at: "2026-04-28T10:00:00Z",
    updated_at: "2026-04-28T10:00:00Z",
    ...overrides,
  };
}

function brief(overrides: Partial<Brief>): Brief {
  return {
    id: "brief-default",
    title: "Brief",
    problem_statement: "Problem",
    frequency: null,
    time_cost_minutes: null,
    affected_scope: null,
    desired_outcome: null,
    urgency: null,
    submitter_id: null,
    status: "submitted",
    admin_notes: null,
    resolution: null,
    resulting_agent_id: null,
    resulting_task_ids: [],
    namespace: "default",
    created_at: "2026-04-28T10:00:00Z",
    updated_at: "2026-04-28T10:00:00Z",
    ...overrides,
  };
}

describe("Forge global view helpers", () => {
  it("groups tasks from multiple namespaces into the same lane", () => {
    const grouped = groupForgeTasksByLane([
      task({ id: "default-backlog", namespace: "default", lane: "backlog" }),
      task({ id: "aiops-backlog", namespace: "aiops", lane: "backlog" }),
      task({ id: "client-review", namespace: "client-a", lane: "research_review" }),
    ]);

    expect(grouped.backlog.map((t) => [t.id, t.namespace])).toEqual([
      ["default-backlog", "default"],
      ["aiops-backlog", "aiops"],
    ]);
    expect(grouped.research_review.map((t) => t.namespace)).toEqual([
      "client-a",
    ]);
  });

  it("counts briefs globally across namespaces", () => {
    const stats = buildGlobalBriefStats([
      brief({ id: "default-submitted", namespace: "default", status: "submitted" }),
      brief({ id: "aiops-submitted", namespace: "aiops", status: "submitted" }),
      brief({ id: "client-triaged", namespace: "client-a", status: "triaged" }),
    ]);

    expect(stats.total).toBe(3);
    expect(stats.by_status.submitted).toBe(2);
    expect(stats.by_status.triaged).toBe(1);
  });
});
