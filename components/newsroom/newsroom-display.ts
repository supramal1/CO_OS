import type { NewsroomSourceStatus } from "@/lib/newsroom/types";

const SOURCE_LABELS: Record<NewsroomSourceStatus["source"], string> = {
  calendar: "Calendar",
  cornerstone: "Cornerstone",
  forge: "Forge",
  notion: "Notion",
  review: "Review",
  workbench: "Workbench",
};

export function deriveNewsroomEmptyMessage(
  statuses: NewsroomSourceStatus[],
): string {
  const allSourcesUnavailable =
    statuses.length > 0 &&
    statuses.every(
      (status) => status.status === "unavailable" || status.status === "error",
    );

  if (allSourcesUnavailable) {
    return "Newsroom could not reach your context sources yet. Workbench setup may need attention.";
  }

  return "No major changes found for today. Workbench and Notion are ready when you need them.";
}

export function sourceStatusLabel(status: NewsroomSourceStatus): string {
  return `${SOURCE_LABELS[status.source]} ${status.status}`;
}

export function sourceLabel(source: NewsroomSourceStatus["source"]): string {
  return SOURCE_LABELS[source];
}
