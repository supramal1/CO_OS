import {
  loadCalendarNewsroomSnapshot,
  loadCornerstoneNewsroomSnapshot,
  loadNotionNewsroomSnapshot,
  loadReviewNewsroomSnapshot,
  loadWorkbenchNewsroomSnapshot,
} from "./adapters";
import { buildSuggestedActions, limitNewsroomSections } from "./ranking";
import type {
  GenerateNewsroomBriefInput,
  NewsroomAdapterContext,
  NewsroomBrief,
  NewsroomCandidate,
  NewsroomSource,
  NewsroomSourceSnapshot,
  NewsroomSourceStatus,
} from "./types";

type NewsroomAdapter = (context: NewsroomAdapterContext) => Promise<NewsroomSourceSnapshot>;

const DEFAULT_ADAPTERS: Array<{ source: NewsroomSource; load: NewsroomAdapter }> = [
  { source: "calendar", load: loadCalendarNewsroomSnapshot },
  { source: "notion", load: loadNotionNewsroomSnapshot },
  { source: "workbench", load: loadWorkbenchNewsroomSnapshot },
  { source: "review", load: loadReviewNewsroomSnapshot },
  { source: "cornerstone", load: loadCornerstoneNewsroomSnapshot },
];

const INJECTED_FAILURE_SOURCES: NewsroomSource[] = [
  "cornerstone",
  "calendar",
  "notion",
  "workbench",
  "review",
];

export async function generateNewsroomBrief(
  input: GenerateNewsroomBriefInput,
): Promise<NewsroomBrief> {
  const now = input.now ?? new Date();
  const range = getUtcDayRange(now);
  const context: NewsroomAdapterContext = {
    userId: input.userId,
    apiKey: input.apiKey ?? null,
    now,
    range,
  };
  const adapters = input.adapters
    ? input.adapters.map((load, index) => ({
        source: INJECTED_FAILURE_SOURCES[index] ?? "cornerstone",
        load,
      }))
    : DEFAULT_ADAPTERS;

  const candidates: NewsroomCandidate[] = [];
  const sourceStatuses: NewsroomSourceStatus[] = [];

  for (const adapter of adapters) {
    try {
      const snapshot = await adapter.load(context);
      candidates.push(...snapshot.candidates);
      sourceStatuses.push(snapshot.status);
    } catch (error) {
      sourceStatuses.push({
        source: adapter.source,
        status: "error",
        reason: errorReason(error),
        itemsCount: 0,
      });
    }
  }

  const sections = limitNewsroomSections(candidates);

  return {
    userId: input.userId,
    generatedAt: now.toISOString(),
    range: {
      from: range.from.toISOString(),
      to: range.to.toISOString(),
    },
    today: sections.today,
    changedSinceYesterday: sections.changedSinceYesterday,
    needsAttention: sections.needsAttention,
    suggestedNextActions: buildSuggestedActions(candidates),
    sourceStatuses,
  };
}

function getUtcDayRange(now: Date): NewsroomAdapterContext["range"] {
  const from = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
  const to = new Date(from);
  to.setUTCDate(to.getUTCDate() + 1);

  const since = new Date(from);
  since.setUTCDate(since.getUTCDate() - 1);

  return { from, to, since };
}

function errorReason(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return "Adapter failed.";
}
