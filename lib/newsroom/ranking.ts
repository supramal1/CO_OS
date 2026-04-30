import type {
  NewsroomAction,
  NewsroomCandidate,
  NewsroomConfidence,
  NewsroomItem,
} from "./types";

const SECTION_LIMITS = {
  today: 3,
  changedSinceYesterday: 4,
  needsAttention: 4,
} as const;

const SIGNAL_SCORES: Record<NewsroomCandidate["signals"][number], number> = {
  meeting_today: 35,
  review_unresolved: 34,
  missing_evidence: 32,
  missing_context: 24,
  cross_source_match: 28,
  changed_since_yesterday: 20,
  human_decision: 30,
  action_available: 12,
  active_work: 14,
  generic_update: -18,
  low_confidence: -14,
};

const CONFIDENCE_SCORES: Record<NewsroomConfidence, number> = {
  high: 18,
  medium: 8,
  low: -8,
};

export function rankNewsroomItems<T extends NewsroomCandidate>(items: T[]): T[] {
  return [...items].sort((a, b) => scoreCandidate(b) - scoreCandidate(a));
}

export function dedupeNewsroomItems(items: NewsroomCandidate[]): NewsroomCandidate[] {
  const byKey = new Map<string, NewsroomCandidate>();
  for (const item of items) {
    const keys = item.sourceRefs.length > 0 ? item.sourceRefs : [normalizeTitle(item.title)];
    const existingKey = keys.find((key) => byKey.has(key));
    if (!existingKey) {
      byKey.set(keys[0], item);
      continue;
    }

    const existing = byKey.get(existingKey);
    if (!existing) continue;

    const stronger = scoreCandidate(item) >= scoreCandidate(existing) ? item : existing;
    const weaker = stronger === item ? existing : item;
    byKey.set(existingKey, {
      ...stronger,
      reason: stronger.reason || weaker.reason,
      sourceRefs: Array.from(new Set([...stronger.sourceRefs, ...weaker.sourceRefs])),
      signals: Array.from(new Set([...stronger.signals, ...weaker.signals])),
      action: stronger.action ?? weaker.action,
    });
  }
  return Array.from(byKey.values());
}

export function limitNewsroomSections(items: NewsroomCandidate[]): {
  today: NewsroomItem[];
  changedSinceYesterday: NewsroomItem[];
  needsAttention: NewsroomItem[];
} {
  const ranked = rankNewsroomItems(dedupeNewsroomItems(items));
  return {
    today: toItems(ranked.filter((item) => item.section === "today").slice(0, SECTION_LIMITS.today)),
    changedSinceYesterday: toItems(
      ranked
        .filter((item) => item.section === "changedSinceYesterday")
        .slice(0, SECTION_LIMITS.changedSinceYesterday),
    ),
    needsAttention: toItems(
      ranked
        .filter((item) => item.section === "needsAttention")
        .slice(0, SECTION_LIMITS.needsAttention),
    ),
  };
}

export function buildSuggestedActions(items: NewsroomCandidate[]): NewsroomAction[] {
  const actions: NewsroomAction[] = [];
  for (const item of rankNewsroomItems(dedupeNewsroomItems(items))) {
    if (!item.action) continue;
    actions.push(item.action);
    if (actions.length === 4) break;
  }
  return actions;
}

function scoreCandidate(item: NewsroomCandidate): number {
  return (
    CONFIDENCE_SCORES[item.confidence] +
    item.signals.reduce((total, signal) => total + SIGNAL_SCORES[signal], 0) +
    (item.action ? 5 : -6)
  );
}

function toItems(items: NewsroomCandidate[]): NewsroomItem[] {
  return items.map(({ section, signals, sourceRefs, ...item }) => item);
}

function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}
