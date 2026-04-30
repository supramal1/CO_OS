import type { NewsroomAction, NewsroomSourceStatus } from "@/lib/newsroom/types";

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

export function sourceStatusDetail(
  status: NewsroomSourceStatus,
): string | null {
  if (status.status === "ok") {
    return status.itemsCount === 1 ? "1 item available" : `${status.itemsCount} items available`;
  }

  if (status.status === "empty") {
    return "No changes found";
  }

  const reason = status.reason?.toLowerCase() ?? "";
  if (status.source === "calendar" && reason.includes("calendar_scope_missing")) {
    return "Calendar needs reconnect";
  }

  if (
    status.source === "cornerstone" &&
    (reason.includes("missing api key") || reason.includes("api key"))
  ) {
    return "Cornerstone is unavailable";
  }

  if (status.status === "unavailable") {
    return `${SOURCE_LABELS[status.source]} is unavailable`;
  }

  return "Check setup or try again";
}

export function sourceLabel(source: NewsroomSourceStatus["source"]): string {
  return SOURCE_LABELS[source];
}

export function dismissItemAriaLabel(title: string): string {
  return `Dismiss ${title}`;
}

export function sourceLinkAriaLabel(title: string): string {
  return `Open source for ${title}`;
}

export function itemActionAriaLabel(
  action: NewsroomAction,
  title: string,
): string {
  return `${action.label} for ${title}`;
}

export function actionLinkAriaLabel(action: NewsroomAction): string {
  return `${action.label} in ${SOURCE_LABELS[action.target]}`;
}
