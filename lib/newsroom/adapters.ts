import type { NewsroomAdapterContext, NewsroomSource, NewsroomSourceSnapshot } from "./types";

export async function loadCalendarNewsroomSnapshot(
  _context: NewsroomAdapterContext,
): Promise<NewsroomSourceSnapshot> {
  return unavailableSnapshot("calendar", "Calendar adapter is not connected yet.");
}

export async function loadNotionNewsroomSnapshot(
  _context: NewsroomAdapterContext,
): Promise<NewsroomSourceSnapshot> {
  return unavailableSnapshot("notion", "Notion adapter is not connected yet.");
}

export async function loadWorkbenchNewsroomSnapshot(
  _context: NewsroomAdapterContext,
): Promise<NewsroomSourceSnapshot> {
  return unavailableSnapshot("workbench", "Workbench adapter is not connected yet.");
}

export async function loadReviewNewsroomSnapshot(
  _context: NewsroomAdapterContext,
): Promise<NewsroomSourceSnapshot> {
  return unavailableSnapshot("review", "Review flags are not available yet.");
}

export async function loadCornerstoneNewsroomSnapshot(
  _context: NewsroomAdapterContext,
): Promise<NewsroomSourceSnapshot> {
  return unavailableSnapshot("cornerstone", "Cornerstone adapter is not connected yet.");
}

function unavailableSnapshot(
  source: NewsroomSource,
  reason: string,
): NewsroomSourceSnapshot {
  return {
    source,
    status: {
      source,
      status: "unavailable",
      reason,
      itemsCount: 0,
    },
    candidates: [],
  };
}
