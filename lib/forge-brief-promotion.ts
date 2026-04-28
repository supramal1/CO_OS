import type { Brief } from "@/lib/forge-types";

const URGENCY_PRIORITY: Record<string, number> = {
  low: 0,
  medium: 1,
  high: 2,
  critical: 3,
};

export type PromoteBriefTaskPayload = {
  title: string;
  description: string;
  priority: number;
  metadata: Record<string, unknown>;
};

export function linkedTaskIds(brief: Pick<Brief, "resulting_task_ids">): string[] {
  return Array.isArray(brief.resulting_task_ids)
    ? brief.resulting_task_ids.filter((id): id is string => typeof id === "string")
    : [];
}

export function buildTaskPayloadFromBrief(brief: Brief): PromoteBriefTaskPayload {
  return {
    title: brief.title,
    description: formatBriefDescription(brief),
    priority: brief.urgency ? (URGENCY_PRIORITY[brief.urgency] ?? 0) : 0,
    metadata: {
      source: "forge_brief",
      brief_id: brief.id,
      frequency: brief.frequency,
      time_cost_minutes: brief.time_cost_minutes,
      affected_scope: brief.affected_scope,
      desired_outcome: brief.desired_outcome,
      urgency: brief.urgency,
      submitter_id: brief.submitter_id,
      brief_created_at: brief.created_at,
    },
  };
}

function formatBriefDescription(brief: Brief): string {
  const sections: string[] = [
    `Forge brief: ${brief.id}`,
    "",
    "Problem",
    brief.problem_statement,
  ];

  if (brief.desired_outcome) {
    sections.push("", "Desired outcome", brief.desired_outcome);
  }

  const context: string[] = [];
  if (brief.frequency) context.push(`Frequency: ${brief.frequency}`);
  if (brief.time_cost_minutes != null) {
    context.push(`Time cost: ${brief.time_cost_minutes} min`);
  }
  if (brief.affected_scope) context.push(`Scope: ${brief.affected_scope}`);
  if (brief.urgency) context.push(`Urgency: ${brief.urgency}`);

  if (context.length > 0) {
    sections.push("", "Context", ...context);
  }

  return sections.join("\n");
}
