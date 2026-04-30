import type {
  NewsroomAction,
  NewsroomSection,
  NewsroomSourceStatus,
} from "@/lib/newsroom/types";

const SOURCE_LABELS: Record<NewsroomSourceStatus["source"], string> = {
  calendar: "Calendar",
  cornerstone: "Cornerstone",
  forge: "Forge",
  notion: "Notion",
  review: "Review",
  workbench: "Workbench",
};

export type FormattedNewsroomReason = {
  narrative: string;
  followUps: Array<{ title: string; detail: string }>;
};

export function deriveNewsroomEmptyMessage(
  statuses: NewsroomSourceStatus[],
): string {
  if (allSourcesUnavailable(statuses)) {
    return "Newsroom could not reach your context sources yet. Workbench setup may need attention.";
  }

  return "No major changes found for today. Workbench and Notion are ready when you need them.";
}

export function newsroomSectionEmptyMessage(
  section: NewsroomSection,
  statuses: NewsroomSourceStatus[],
): string {
  if (allSourcesUnavailable(statuses)) {
    return deriveNewsroomEmptyMessage(statuses);
  }

  if (section === "today") {
    return "No meetings or active work found for today.";
  }
  if (section === "changedSinceYesterday") {
    return "No source-backed changes found since yesterday.";
  }
  return "No judgement items found right now.";
}

export function sourceStatusLabel(status: NewsroomSourceStatus): string {
  if (isNotConnectedStatus(status)) {
    return `${SOURCE_LABELS[status.source]} not connected`;
  }

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
  if (isNotConnectedStatus(status)) {
    return `Connect ${SOURCE_LABELS[status.source]} in Workbench`;
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

export function formatNewsroomReason(reason: string): FormattedNewsroomReason {
  const [narrativePart, followUpPart] = reason.split(/\n\s*\nWorth looking at\n/i);
  const narrative = normalizeReasonText(narrativePart);
  const followUps = (followUpPart ?? "")
    .split(/\n+/)
    .flatMap((line) => {
      const match = line.trim().match(/^-\s*([^:]+):\s*(.+)$/);
      if (!match) return [];
      return [
        {
          title: normalizeReasonText(match[1]),
          detail: normalizeReasonText(match[2]),
        },
      ];
    });

  return { narrative, followUps };
}

function allSourcesUnavailable(statuses: NewsroomSourceStatus[]): boolean {
  return (
    statuses.length > 0 &&
    statuses.every(
      (status) => status.status === "unavailable" || status.status === "error",
    )
  );
}

function isNotConnectedStatus(status: NewsroomSourceStatus): boolean {
  if (status.source !== "calendar" && status.source !== "notion") return false;
  if (status.status !== "unavailable" && status.status !== "error") return false;
  return true;
}

function normalizeReasonText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}
