import {
  loadCalendarNewsroomSnapshot,
  loadCornerstoneNewsroomSnapshot,
  loadNotionNewsroomSnapshot,
  loadReviewNewsroomSnapshot,
  loadWorkbenchNewsroomSnapshot,
} from "./adapters";
import { buildSuggestedActions, limitNewsroomSections } from "./ranking";
import type {
  NewsroomAdapter,
  GenerateNewsroomBriefInput,
  NewsroomAdapterContext,
  NewsroomBrief,
  NewsroomCandidate,
  NewsroomSourceSnapshot,
} from "./types";

const DEFAULT_ADAPTERS: NewsroomAdapter[] = [
  { source: "calendar", load: loadCalendarNewsroomSnapshot },
  { source: "notion", load: loadNotionNewsroomSnapshot },
  { source: "workbench", load: loadWorkbenchNewsroomSnapshot },
  { source: "review", load: loadReviewNewsroomSnapshot },
  { source: "cornerstone", load: loadCornerstoneNewsroomSnapshot },
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
  const adapters = input.adapters ?? DEFAULT_ADAPTERS;

  const snapshots = await Promise.all(adapters.map((adapter) => loadSnapshot(adapter, context)));
  const candidates: NewsroomCandidate[] = snapshots.flatMap((snapshot) => snapshot.candidates);
  const sourceStatuses = snapshots.map((snapshot) => snapshot.status);
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

async function loadSnapshot(
  adapter: NewsroomAdapter,
  context: NewsroomAdapterContext,
): Promise<NewsroomSourceSnapshot> {
  try {
    return await adapter.load(context);
  } catch (error) {
    return {
      source: adapter.source,
      status: {
        source: adapter.source,
        status: "error",
        reason: errorReason(error),
        itemsCount: 0,
      },
      candidates: [],
    };
  }
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
