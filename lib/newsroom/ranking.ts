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

const MIN_SIMILAR_TITLE_TOKENS = 3;
const MIN_SIMILAR_TITLE_JACCARD = 0.6;
const GENERIC_TITLE_TOKENS = new Set([
  "a",
  "an",
  "and",
  "are",
  "client",
  "for",
  "in",
  "is",
  "needs",
  "of",
  "the",
  "to",
]);

export function rankNewsroomItems<T extends NewsroomCandidate>(items: T[]): T[] {
  return [...items].sort(compareCandidates);
}

export function dedupeNewsroomItems(items: NewsroomCandidate[]): NewsroomCandidate[] {
  const groups: NewsroomCandidate[] = [];
  const keyToGroup = new Map<string, number>();

  for (const item of items) {
    const keys = candidateDedupeKeys(item);
    const matchingGroups = Array.from(
      new Set(
        keys
          .map((key) => keyToGroup.get(key))
          .filter((index): index is number => index !== undefined),
      ),
    );
    for (const [index, group] of groups.entries()) {
      if (matchingGroups.includes(index)) continue;
      if (hasSimilarTitle(item, group)) {
        matchingGroups.push(index);
      }
    }

    if (matchingGroups.length === 0) {
      groups.push(item);
      rebuildDedupeIndex(groups, keyToGroup);
      continue;
    }

    const targetGroup = Math.min(...matchingGroups);
    const candidates = [item, ...matchingGroups.map((index) => groups[index])];
    groups[targetGroup] = mergeCandidates(candidates);

    for (const index of matchingGroups.sort((a, b) => b - a)) {
      if (index !== targetGroup) {
        groups.splice(index, 1);
      }
    }
    rebuildDedupeIndex(groups, keyToGroup);
  }

  return groups;
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

function compareCandidates(a: NewsroomCandidate, b: NewsroomCandidate): number {
  const scoreDelta = scoreCandidate(b) - scoreCandidate(a);
  if (scoreDelta !== 0) return scoreDelta;

  return (
    compareStrings(a.source, b.source) ||
    compareStrings(normalizeTitle(a.title), normalizeTitle(b.title)) ||
    compareStrings(a.id, b.id)
  );
}

function mergeCandidates(candidates: NewsroomCandidate[]): NewsroomCandidate {
  const [stronger, ...weaker] = rankNewsroomItems(candidates);
  return {
    ...stronger,
    reason: stronger.reason || weaker.find((candidate) => candidate.reason)?.reason || "",
    sourceRefs: unique(candidates.flatMap((candidate) => candidate.sourceRefs)),
    signals: unique(candidates.flatMap((candidate) => candidate.signals)),
    action: stronger.action ?? weaker.find((candidate) => candidate.action)?.action,
  };
}

function toItems(items: NewsroomCandidate[]): NewsroomItem[] {
  return items.map(({ section, signals, sourceRefs, ...item }) => item);
}

function candidateDedupeKeys(item: NewsroomCandidate): string[] {
  return unique([...item.sourceRefs, normalizeTitle(item.title)].filter(Boolean));
}

function rebuildDedupeIndex(
  groups: NewsroomCandidate[],
  keyToGroup: Map<string, number>,
): void {
  keyToGroup.clear();
  groups.forEach((item, index) => {
    for (const key of candidateDedupeKeys(item)) {
      keyToGroup.set(key, index);
    }
  });
}

function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function hasSimilarTitle(a: NewsroomCandidate, b: NewsroomCandidate): boolean {
  const aTokens = titleTokens(a.title);
  const bTokens = titleTokens(b.title);
  if (aTokens.length < MIN_SIMILAR_TITLE_TOKENS || bTokens.length < MIN_SIMILAR_TITLE_TOKENS) {
    return false;
  }

  const aIdentifierTokens = aTokens.filter((token) => token.length <= 2);
  const bIdentifierTokens = bTokens.filter((token) => token.length <= 2);
  if (
    aIdentifierTokens.length > 0 &&
    bIdentifierTokens.length > 0 &&
    !aIdentifierTokens.some((token) => bIdentifierTokens.includes(token))
  ) {
    return false;
  }

  const shared = aTokens.filter((token) => bTokens.includes(token));
  if (shared.length < MIN_SIMILAR_TITLE_TOKENS) {
    return false;
  }

  const union = unique([...aTokens, ...bTokens]);
  return shared.length / union.length >= MIN_SIMILAR_TITLE_JACCARD;
}

function titleTokens(title: string): string[] {
  return normalizeTitle(title)
    .split(" ")
    .filter((token) => token && !GENERIC_TITLE_TOKENS.has(token));
}

function compareStrings(a: string, b: string): number {
  return a.localeCompare(b);
}

function unique<T>(values: T[]): T[] {
  return Array.from(new Set(values));
}
