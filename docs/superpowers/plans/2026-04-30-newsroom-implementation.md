# Newsroom MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the `/newsroom` CO OS surface, backed by a structured brief API and a test-covered aggregation layer that uses live sources where existing CO OS boundaries are reliable.

**Architecture:** Add a small `lib/newsroom` domain with shared types, pure ranking/de-dupe helpers, source adapters, and a `generateNewsroomBrief` orchestrator. Expose it through `GET /api/newsroom/brief`, render it in `components/newsroom/newsroom-shell.tsx`, and add the route to OS navigation. Adapters must degrade independently so one failed source never breaks the whole brief.

**Tech Stack:** Next.js App Router, React 19 client components, Auth.js session principal ids, existing Workbench Calendar/Notion/Run History helpers, Cornerstone REST context endpoint, Vitest.

---

## File Structure

- Create `lib/newsroom/types.ts`: public Newsroom model, source snapshot model, adapter result model, and generation input types.
- Create `lib/newsroom/ranking.ts`: pure scoring, section limiting, action extraction, and de-dupe helpers.
- Create `lib/newsroom/adapters.ts`: source adapter functions for calendar, notion, workbench, review, and cornerstone.
- Create `lib/newsroom/brief.ts`: orchestrates adapters, candidate conversion, ranking, and final brief assembly.
- Create `app/api/newsroom/brief/route.ts`: authenticated API route.
- Create `components/newsroom/newsroom-display.ts`: pure display helpers for the client shell.
- Create `components/newsroom/newsroom-shell.tsx`: OS-aligned client UI.
- Create `app/(os)/newsroom/page.tsx`: route entrypoint.
- Modify `lib/modules.ts`: add Newsroom to module ids, modules, nav grouping, and default staff flow position.
- Add tests in `__tests__/newsroom-ranking.test.ts`, `__tests__/newsroom-brief.test.ts`, `__tests__/newsroom-route.test.ts`, and `__tests__/newsroom-display.test.ts`.

---

### Task 1: Newsroom Types And Ranking Core

**Files:**
- Create: `lib/newsroom/types.ts`
- Create: `lib/newsroom/ranking.ts`
- Test: `__tests__/newsroom-ranking.test.ts`

- [ ] **Step 1: Write the failing ranking tests**

Create `__tests__/newsroom-ranking.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  buildSuggestedActions,
  dedupeNewsroomItems,
  limitNewsroomSections,
  rankNewsroomItems,
} from "@/lib/newsroom/ranking";
import type { NewsroomCandidate } from "@/lib/newsroom/types";

const workbenchAction = {
  label: "Open Workbench",
  target: "workbench" as const,
  href: "/workbench",
};

function candidate(
  overrides: Partial<NewsroomCandidate> = {},
): NewsroomCandidate {
  return {
    id: "item-base",
    title: "Project Atlas needs a decision",
    reason: "The client check-in is today and the recommendation is unresolved.",
    source: "workbench",
    confidence: "medium",
    section: "needsAttention",
    href: "/workbench",
    action: workbenchAction,
    signals: ["human_decision", "meeting_today", "action_available"],
    sourceRefs: ["workbench:run-1"],
    ...overrides,
  };
}

describe("Newsroom ranking", () => {
  it("promotes meeting, review, missing-evidence, cross-source, and action-bearing signals", () => {
    const ranked = rankNewsroomItems([
      candidate({
        id: "generic",
        title: "Generic file update",
        confidence: "high",
        signals: ["generic_update"],
        action: undefined,
      }),
      candidate({
        id: "priority",
        title: "Client X draft needs evidence",
        source: "review",
        confidence: "medium",
        signals: [
          "meeting_today",
          "review_unresolved",
          "missing_evidence",
          "cross_source_match",
          "human_decision",
          "action_available",
        ],
        action: { label: "Open Review", target: "review", href: "/forge/production-review" },
      }),
    ]);

    expect(ranked.map((item) => item.id)).toEqual(["priority", "generic"]);
  });

  it("dedupes similar titles and shared source refs while preserving the stronger action", () => {
    const deduped = dedupeNewsroomItems([
      candidate({
        id: "a",
        title: "Client X draft needs evidence",
        confidence: "low",
        action: undefined,
        sourceRefs: ["review:flag-1"],
      }),
      candidate({
        id: "b",
        title: "Client X draft needs evidence.",
        confidence: "high",
        sourceRefs: ["review:flag-1"],
        action: { label: "Open Review", target: "review", href: "/forge/production-review" },
      }),
    ]);

    expect(deduped).toHaveLength(1);
    expect(deduped[0]).toMatchObject({
      id: "b",
      confidence: "high",
      action: { label: "Open Review" },
    });
  });

  it("limits sections and suggested actions to the MVP defaults", () => {
    const many = Array.from({ length: 6 }, (_, index) =>
      candidate({
        id: `today-${index}`,
        title: `Today item ${index}`,
        section: "today",
        sourceRefs: [`calendar:${index}`],
      }),
    );

    const sections = limitNewsroomSections(many);
    const actions = buildSuggestedActions(many);

    expect(sections.today).toHaveLength(3);
    expect(actions).toHaveLength(4);
  });
});
```

- [ ] **Step 2: Run the ranking test to verify it fails**

Run: `npm test -- __tests__/newsroom-ranking.test.ts`

Expected: FAIL because `@/lib/newsroom/ranking` and `@/lib/newsroom/types` do not exist.

- [ ] **Step 3: Add shared Newsroom types**

Create `lib/newsroom/types.ts`:

```ts
export type NewsroomSource =
  | "cornerstone"
  | "notion"
  | "calendar"
  | "workbench"
  | "review"
  | "forge";

export type NewsroomConfidence = "high" | "medium" | "low";
export type NewsroomSection = "today" | "changedSinceYesterday" | "needsAttention";

export type NewsroomBrief = {
  userId: string;
  generatedAt: string;
  range: {
    from: string;
    to: string;
  };
  today: NewsroomItem[];
  changedSinceYesterday: NewsroomItem[];
  needsAttention: NewsroomItem[];
  suggestedNextActions: NewsroomAction[];
  sourceStatuses: NewsroomSourceStatus[];
};

export type NewsroomItem = {
  id: string;
  title: string;
  reason: string;
  source: NewsroomSource;
  confidence: NewsroomConfidence;
  href?: string;
  action?: NewsroomAction;
};

export type NewsroomAction = {
  label: string;
  target: "workbench" | "review" | "notion" | "forge" | "calendar";
  href: string;
};

export type NewsroomSourceStatus = {
  source: NewsroomSource;
  status: "ok" | "empty" | "unavailable" | "error";
  reason?: string;
  itemsCount: number;
};

export type NewsroomSignal =
  | "meeting_today"
  | "review_unresolved"
  | "missing_evidence"
  | "missing_context"
  | "cross_source_match"
  | "changed_since_yesterday"
  | "human_decision"
  | "action_available"
  | "active_work"
  | "generic_update"
  | "low_confidence";

export type NewsroomCandidate = NewsroomItem & {
  section: NewsroomSection;
  signals: NewsroomSignal[];
  sourceRefs: string[];
};

export type NewsroomSourceSnapshot = {
  source: NewsroomSource;
  status: NewsroomSourceStatus;
  candidates: NewsroomCandidate[];
};

export type NewsroomAdapterContext = {
  userId: string;
  apiKey: string | null;
  now: Date;
  range: {
    from: Date;
    to: Date;
    since: Date;
  };
};

export type GenerateNewsroomBriefInput = {
  userId: string;
  apiKey?: string | null;
  now?: Date;
  adapters?: Array<(context: NewsroomAdapterContext) => Promise<NewsroomSourceSnapshot>>;
};
```

- [ ] **Step 4: Add ranking implementation**

Create `lib/newsroom/ranking.ts`:

```ts
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
  const seen = new Set<string>();
  const actions: NewsroomAction[] = [];
  for (const item of rankNewsroomItems(dedupeNewsroomItems(items))) {
    if (!item.action) continue;
    const key = `${item.action.target}:${item.action.href}:${item.action.label}`;
    if (seen.has(key)) continue;
    seen.add(key);
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
```

- [ ] **Step 5: Run the ranking test to verify it passes**

Run: `npm test -- __tests__/newsroom-ranking.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit Task 1**

```bash
git add __tests__/newsroom-ranking.test.ts lib/newsroom/types.ts lib/newsroom/ranking.ts
git commit -m "Add Newsroom ranking core"
```

---

### Task 2: Brief Generator With Injectable Adapters

**Files:**
- Create: `lib/newsroom/brief.ts`
- Test: `__tests__/newsroom-brief.test.ts`

- [ ] **Step 1: Write failing generator tests**

Create `__tests__/newsroom-brief.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { generateNewsroomBrief } from "@/lib/newsroom/brief";
import type { NewsroomSourceSnapshot } from "@/lib/newsroom/types";

const now = new Date("2026-04-30T09:00:00.000Z");

function snapshot(overrides: Partial<NewsroomSourceSnapshot>): NewsroomSourceSnapshot {
  return {
    source: "workbench",
    status: {
      source: "workbench",
      status: "ok",
      itemsCount: 1,
    },
    candidates: [],
    ...overrides,
  };
}

describe("generateNewsroomBrief", () => {
  it("combines adapter candidates into brief sections and actions", async () => {
    const brief = await generateNewsroomBrief({
      userId: "principal_123",
      now,
      adapters: [
        async () =>
          snapshot({
            source: "calendar",
            status: { source: "calendar", status: "ok", itemsCount: 1 },
            candidates: [
              {
                id: "calendar-event-1",
                title: "Prepare for 11:00 Client X check-in",
                reason: "Client X appears in today's calendar.",
                source: "calendar",
                confidence: "high",
                section: "today",
                href: "https://calendar.google.com/event?eid=event-1",
                action: { label: "Open Calendar", target: "calendar", href: "https://calendar.google.com/event?eid=event-1" },
                signals: ["meeting_today", "action_available"],
                sourceRefs: ["calendar:event-1"],
              },
            ],
          }),
      ],
    });

    expect(brief).toMatchObject({
      userId: "principal_123",
      generatedAt: now.toISOString(),
      today: [{ title: "Prepare for 11:00 Client X check-in" }],
      suggestedNextActions: [{ label: "Open Calendar" }],
      sourceStatuses: [{ source: "calendar", status: "ok", itemsCount: 1 }],
    });
    expect(brief.range.from).toBe("2026-04-30T00:00:00.000Z");
    expect(brief.range.to).toBe("2026-05-01T00:00:00.000Z");
  });

  it("returns a valid partial brief when one adapter throws", async () => {
    const brief = await generateNewsroomBrief({
      userId: "principal_123",
      now,
      adapters: [
        async () => {
          throw new Error("Cornerstone timeout");
        },
        async () =>
          snapshot({
            source: "review",
            status: { source: "review", status: "empty", itemsCount: 0 },
            candidates: [],
          }),
      ],
    });

    expect(brief.today).toEqual([]);
    expect(brief.sourceStatuses).toEqual([
      {
        source: "cornerstone",
        status: "error",
        reason: "Cornerstone timeout",
        itemsCount: 0,
      },
      { source: "review", status: "empty", itemsCount: 0 },
    ]);
  });
});
```

- [ ] **Step 2: Run generator tests to verify failure**

Run: `npm test -- __tests__/newsroom-brief.test.ts`

Expected: FAIL because `@/lib/newsroom/brief` does not exist.

- [ ] **Step 3: Implement generator**

Create `lib/newsroom/brief.ts`:

```ts
import { buildSuggestedActions, limitNewsroomSections } from "./ranking";
import type {
  GenerateNewsroomBriefInput,
  NewsroomAdapterContext,
  NewsroomBrief,
  NewsroomSource,
  NewsroomSourceSnapshot,
} from "./types";
import {
  loadCalendarNewsroomSnapshot,
  loadCornerstoneNewsroomSnapshot,
  loadNotionNewsroomSnapshot,
  loadReviewNewsroomSnapshot,
  loadWorkbenchNewsroomSnapshot,
} from "./adapters";

const FALLBACK_SOURCES: NewsroomSource[] = [
  "calendar",
  "notion",
  "workbench",
  "review",
  "cornerstone",
];

export async function generateNewsroomBrief(
  input: GenerateNewsroomBriefInput,
): Promise<NewsroomBrief> {
  const now = input.now ?? new Date();
  const range = dayRange(now);
  const context: NewsroomAdapterContext = {
    userId: input.userId,
    apiKey: input.apiKey ?? null,
    now,
    range,
  };
  const adapters =
    input.adapters ?? [
      loadCalendarNewsroomSnapshot,
      loadNotionNewsroomSnapshot,
      loadWorkbenchNewsroomSnapshot,
      loadReviewNewsroomSnapshot,
      loadCornerstoneNewsroomSnapshot,
    ];

  const snapshots = await Promise.all(
    adapters.map(async (adapter, index) => {
      try {
        return await adapter(context);
      } catch (error) {
        const source = FALLBACK_SOURCES[index] ?? "cornerstone";
        return failedSnapshot(source, error);
      }
    }),
  );

  const candidates = snapshots.flatMap((snapshot) => snapshot.candidates);
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
    sourceStatuses: snapshots.map((snapshot) => snapshot.status),
  };
}

function dayRange(now: Date): NewsroomAdapterContext["range"] {
  const from = new Date(now);
  from.setUTCHours(0, 0, 0, 0);
  const to = new Date(from);
  to.setUTCDate(to.getUTCDate() + 1);
  const since = new Date(from);
  since.setUTCDate(since.getUTCDate() - 1);
  return { from, to, since };
}

function failedSnapshot(
  source: NewsroomSource,
  error: unknown,
): NewsroomSourceSnapshot {
  return {
    source,
    status: {
      source,
      status: "error",
      reason: error instanceof Error ? error.message : String(error),
      itemsCount: 0,
    },
    candidates: [],
  };
}
```

- [ ] **Step 4: Add adapter stubs so the generator compiles**

Create `lib/newsroom/adapters.ts`:

```ts
import type { NewsroomAdapterContext, NewsroomSourceSnapshot } from "./types";

export async function loadCalendarNewsroomSnapshot(
  _context: NewsroomAdapterContext,
): Promise<NewsroomSourceSnapshot> {
  return emptySnapshot("calendar", "Calendar adapter is not connected yet.");
}

export async function loadNotionNewsroomSnapshot(
  _context: NewsroomAdapterContext,
): Promise<NewsroomSourceSnapshot> {
  return emptySnapshot("notion", "Notion adapter is not connected yet.");
}

export async function loadWorkbenchNewsroomSnapshot(
  _context: NewsroomAdapterContext,
): Promise<NewsroomSourceSnapshot> {
  return emptySnapshot("workbench", "Workbench adapter is not connected yet.");
}

export async function loadReviewNewsroomSnapshot(
  _context: NewsroomAdapterContext,
): Promise<NewsroomSourceSnapshot> {
  return emptySnapshot("review", "Review flags are not available yet.");
}

export async function loadCornerstoneNewsroomSnapshot(
  _context: NewsroomAdapterContext,
): Promise<NewsroomSourceSnapshot> {
  return emptySnapshot("cornerstone", "Cornerstone adapter is not connected yet.");
}

function emptySnapshot(
  source: NewsroomSourceSnapshot["source"],
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
```

- [ ] **Step 5: Run generator and ranking tests**

Run: `npm test -- __tests__/newsroom-ranking.test.ts __tests__/newsroom-brief.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit Task 2**

```bash
git add __tests__/newsroom-brief.test.ts lib/newsroom/brief.ts lib/newsroom/adapters.ts
git commit -m "Add Newsroom brief generator"
```

---

### Task 3: Live Workbench, Review, And Cornerstone Adapters

**Files:**
- Modify: `lib/newsroom/adapters.ts`
- Test: `__tests__/newsroom-brief.test.ts`

- [ ] **Step 1: Add failing adapter-focused tests**

Append these tests to `__tests__/newsroom-brief.test.ts`:

```ts
import {
  loadCornerstoneNewsroomSnapshot,
  loadReviewNewsroomSnapshot,
  loadWorkbenchNewsroomSnapshot,
} from "@/lib/newsroom/adapters";

describe("Newsroom adapters", () => {
  it("maps unavailable review flags to an empty review snapshot", async () => {
    const snapshot = await loadReviewNewsroomSnapshot({
      userId: "principal_123",
      apiKey: null,
      now,
      range: {
        from: new Date("2026-04-30T00:00:00.000Z"),
        to: new Date("2026-05-01T00:00:00.000Z"),
        since: new Date("2026-04-29T00:00:00.000Z"),
      },
    });

    expect(snapshot).toEqual({
      source: "review",
      status: { source: "review", status: "empty", itemsCount: 0 },
      candidates: [],
    });
  });
});
```

Create a separate mockable test block in the same file only after checking current import hoisting requirements. If mocking `listWorkbenchRuns` or `fetch` makes this file noisy, create `__tests__/newsroom-adapters.test.ts` with `vi.hoisted` mocks.

- [ ] **Step 2: Run tests to verify failure**

Run: `npm test -- __tests__/newsroom-brief.test.ts`

Expected: FAIL because the current review adapter returns `unavailable`.

- [ ] **Step 3: Implement review empty adapter and live Cornerstone adapter**

Modify `lib/newsroom/adapters.ts` so Review is explicit empty and Cornerstone uses the existing REST endpoint:

```ts
import { CORNERSTONE_URL } from "@/lib/cornerstone";
import { listWorkbenchRuns } from "@/lib/workbench/run-history";
import type { WorkbenchRunHistoryRow } from "@/lib/workbench/run-history";
import type {
  NewsroomAdapterContext,
  NewsroomCandidate,
  NewsroomSource,
  NewsroomSourceSnapshot,
} from "./types";

export async function loadReviewNewsroomSnapshot(): Promise<NewsroomSourceSnapshot> {
  return {
    source: "review",
    status: { source: "review", status: "empty", itemsCount: 0 },
    candidates: [],
  };
}

export async function loadCornerstoneNewsroomSnapshot(
  context: NewsroomAdapterContext,
): Promise<NewsroomSourceSnapshot> {
  if (!context.apiKey) {
    return unavailableSnapshot("cornerstone", "Missing Cornerstone API key.");
  }
  const res = await fetch(`${CORNERSTONE_URL.replace(/\/+$/, "")}/context`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-API-Key": context.apiKey,
    },
    body: JSON.stringify({
      query: "Newsroom daily orientation: active projects, clients, recent decisions, and judgement needs.",
      namespace: "default",
      detail_level: "minimal",
      max_tokens: 600,
    }),
    cache: "no-store",
  });
  if (!res.ok) {
    return errorSnapshot("cornerstone", `Cornerstone returned ${res.status}.`);
  }
  const body = (await res.json().catch(() => null)) as unknown;
  const text = contextText(body);
  if (!text) return emptySnapshot("cornerstone");
  return {
    source: "cornerstone",
    status: { source: "cornerstone", status: "ok", itemsCount: 1 },
    candidates: [
      {
        id: "cornerstone-active-context",
        title: "Active context is available",
        reason: firstSentence(text),
        source: "cornerstone",
        confidence: "medium",
        section: "today",
        signals: ["active_work"],
        sourceRefs: ["cornerstone:context"],
      },
    ],
  };
}

function contextText(body: unknown): string {
  if (typeof body === "string") return body.trim();
  if (!body || typeof body !== "object") return "";
  const record = body as Record<string, unknown>;
  for (const key of ["context", "result", "answer", "content", "text"]) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function firstSentence(text: string): string {
  return text.split(/(?<=[.!?])\s+/)[0]?.trim() || text.slice(0, 220);
}
```

- [ ] **Step 4: Implement live Workbench run-history adapter in the same file**

Add this implementation and helpers in `lib/newsroom/adapters.ts`:

```ts
export async function loadWorkbenchNewsroomSnapshot(
  context: NewsroomAdapterContext,
): Promise<NewsroomSourceSnapshot> {
  const result = await listWorkbenchRuns({ userId: context.userId, limit: 20 });
  if (result.status === "unavailable") {
    return unavailableSnapshot("workbench", result.error);
  }
  if (result.status === "error") {
    return errorSnapshot("workbench", result.detail);
  }
  const recent = result.runs.filter(
    (run) => Date.parse(run.created_at) >= context.range.since.getTime(),
  );
  const candidates = recent.flatMap(workbenchRunToCandidates);
  return {
    source: "workbench",
    status: {
      source: "workbench",
      status: candidates.length > 0 ? "ok" : "empty",
      itemsCount: candidates.length,
    },
    candidates,
  };
}

function workbenchRunToCandidates(run: WorkbenchRunHistoryRow): NewsroomCandidate[] {
  const candidates: NewsroomCandidate[] = [
    {
      id: `workbench-run-${run.id}`,
      title: summarizeAsk(run.ask),
      reason: "A Workbench run changed since yesterday.",
      source: "workbench",
      confidence: "medium",
      section: "changedSinceYesterday",
      href: "/workbench",
      action: { label: "Open Workbench", target: "workbench", href: "/workbench" },
      signals: ["changed_since_yesterday", "active_work", "action_available"],
      sourceRefs: [`workbench:${run.id}`],
    },
  ];

  const missingContext = run.result?.missing_context ?? [];
  const warnings = run.result?.warnings ?? [];
  if (missingContext.length > 0 || warnings.length > 0) {
    candidates.push({
      id: `workbench-attention-${run.id}`,
      title: `${summarizeAsk(run.ask)} needs attention`,
      reason: missingContext[0]?.question ?? warnings[0] ?? "Workbench flagged missing context.",
      source: "workbench",
      confidence: "high",
      section: "needsAttention",
      href: "/workbench",
      action: { label: "Open Workbench", target: "workbench", href: "/workbench" },
      signals: ["missing_context", "human_decision", "action_available"],
      sourceRefs: [`workbench:${run.id}`],
    });
  }

  return candidates;
}

function summarizeAsk(ask: string): string {
  const trimmed = ask.trim().replace(/\s+/g, " ");
  if (!trimmed) return "Recent Workbench run";
  return trimmed.length > 72 ? `${trimmed.slice(0, 69)}...` : trimmed;
}
```

- [ ] **Step 5: Keep the shared status helpers in the same file**

Ensure these helpers exist at the bottom of `lib/newsroom/adapters.ts` and are used by all adapters:

```ts
function emptySnapshot(source: NewsroomSource): NewsroomSourceSnapshot {
  return {
    source,
    status: { source, status: "empty", itemsCount: 0 },
    candidates: [],
  };
}

function unavailableSnapshot(
  source: NewsroomSource,
  reason: string,
): NewsroomSourceSnapshot {
  return {
    source,
    status: { source, status: "unavailable", reason, itemsCount: 0 },
    candidates: [],
  };
}

function errorSnapshot(source: NewsroomSource, reason: string): NewsroomSourceSnapshot {
  return {
    source,
    status: { source, status: "error", reason, itemsCount: 0 },
    candidates: [],
  };
}
```

- [ ] **Step 6: Run focused tests**

Run: `npm test -- __tests__/newsroom-brief.test.ts __tests__/newsroom-ranking.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit Task 3**

```bash
git add __tests__/newsroom-brief.test.ts lib/newsroom/adapters.ts
git commit -m "Connect Newsroom core adapters"
```

---

### Task 4: Calendar And Notion Adapter Integration

**Files:**
- Modify: `lib/newsroom/adapters.ts`
- Test: `__tests__/newsroom-brief.test.ts` or `__tests__/newsroom-adapters.test.ts`

- [ ] **Step 1: Confirm existing Workbench Calendar and Notion retrieval signatures**

Run:

```bash
sed -n '1,220p' lib/workbench/retrieval/calendar.ts
sed -n '1,220p' lib/workbench/retrieval/notion.ts
sed -n '1,220p' lib/workbench/retrieval/types.ts
sed -n '1,120p' lib/workbench/retrieval/config.ts
```

Expected: confirm that `retrieveCalendarContext` accepts an injected `client`, `retrieveNotionContext` accepts `userId` and `config`, `WorkbenchRetrievedContext` is exported from `lib/workbench/types.ts`, and `getUserWorkbenchConfig` is exported from `lib/workbench/retrieval/config.ts`.

- [ ] **Step 2: Write failing mapping tests with injected source items**

Create `__tests__/newsroom-adapters.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  calendarContextItemsToNewsroomSnapshot,
  notionContextItemsToNewsroomSnapshot,
} from "@/lib/newsroom/adapters";

describe("Newsroom source mapping helpers", () => {
  it("maps calendar context into Today meeting candidates", () => {
    const snapshot = calendarContextItemsToNewsroomSnapshot([
      {
        claim: "Calendar event: Client X check-in at 11:00",
        source_type: "calendar",
        source_label: "Client X check-in",
        source_url: "https://calendar.google.com/event?eid=event-1",
        metadata: { event_id: "event-1" },
      },
    ]);

    expect(snapshot.candidates[0]).toMatchObject({
      title: "Client X check-in",
      section: "today",
      source: "calendar",
      action: { label: "Open Calendar" },
    });
  });

  it("maps Notion Working On context into active work candidates", () => {
    const snapshot = notionContextItemsToNewsroomSnapshot([
      {
        claim: "Working On: Project Atlas draft for Client X",
        source_type: "notion",
        source_label: "Working On",
        source_url: "https://notion.so/page",
        metadata: { page_title: "Working On" },
      },
    ]);

    expect(snapshot.candidates[0]).toMatchObject({
      title: "Project Atlas draft for Client X",
      section: "today",
      source: "notion",
      action: { label: "Open Notion" },
    });
  });
});
```

- [ ] **Step 3: Run tests to verify failure**

Run: `npm test -- __tests__/newsroom-adapters.test.ts`

Expected: FAIL because the mapping helpers do not exist.

- [ ] **Step 4: Implement mapping helpers and wire live retrieval conservatively**

Modify `lib/newsroom/adapters.ts`:

```ts
import { createGoogleCalendarClient } from "@/lib/workbench/google-calendar";
import { getWorkbenchGoogleAccessToken } from "@/lib/workbench/google-token";
import { createWorkbenchGoogleTokenStore } from "@/lib/workbench/google-token-store";
import { getUserWorkbenchConfig } from "@/lib/workbench/retrieval/config";
import { retrieveCalendarContext } from "@/lib/workbench/retrieval/calendar";
import { retrieveNotionContext } from "@/lib/workbench/retrieval/notion";
import type { WorkbenchRetrievedContext } from "@/lib/workbench/types";

export async function loadCalendarNewsroomSnapshot(
  context: NewsroomAdapterContext,
): Promise<NewsroomSourceSnapshot> {
  const config = await getUserWorkbenchConfig(context.userId);
  if (!config?.google_oauth_scopes?.includes("https://www.googleapis.com/auth/calendar.readonly")) {
    return unavailableSnapshot("calendar", "calendar_scope_missing");
  }
  const tokenResult = await getWorkbenchGoogleAccessToken({
    principalId: context.userId,
    now: context.now,
    tokenStore: createWorkbenchGoogleTokenStore(),
  });
  if (tokenResult.status === "unavailable") {
    return unavailableSnapshot("calendar", tokenResult.reason);
  }
  if (tokenResult.status === "error") {
    return errorSnapshot("calendar", tokenResult.message);
  }
  const clientResult = createGoogleCalendarClient({
    accessToken: tokenResult.accessToken,
  });
  if (clientResult.status === "unavailable") {
    return unavailableSnapshot("calendar", clientResult.reason);
  }
  const result = await retrieveCalendarContext({
    ask: "Newsroom daily orientation: meetings today and prep needs",
    now: context.now,
    client: clientResult.client,
  });
  if (result.status.status === "unavailable") {
    return unavailableSnapshot("calendar", result.status.reason);
  }
  if (result.status.status === "error") {
    return errorSnapshot("calendar", result.status.reason);
  }
  return calendarContextItemsToNewsroomSnapshot(result.items);
}

export async function loadNotionNewsroomSnapshot(
  context: NewsroomAdapterContext,
): Promise<NewsroomSourceSnapshot> {
  const config = await getUserWorkbenchConfig(context.userId);
  const result = await retrieveNotionContext({
    ask: "Newsroom daily orientation: Working On, active clients, active projects, profile context",
    userId: context.userId,
    config,
  });
  if (result.status.status === "unavailable") {
    return unavailableSnapshot("notion", result.status.reason);
  }
  if (result.status.status === "error") {
    return errorSnapshot("notion", result.status.reason);
  }
  return notionContextItemsToNewsroomSnapshot(result.items);
}

export function calendarContextItemsToNewsroomSnapshot(
  items: WorkbenchRetrievedContext[],
): NewsroomSourceSnapshot {
  const candidates = items.slice(0, 6).map((item, index) => ({
    id: `calendar-${String(item.metadata?.event_id ?? index)}`,
    title: item.source_label || cleanClaim(item.claim),
    reason: "This meeting is on today’s calendar.",
    source: "calendar" as const,
    confidence: "high" as const,
    section: "today" as const,
    href: item.source_url ?? undefined,
    action: item.source_url
      ? { label: "Open Calendar", target: "calendar" as const, href: item.source_url }
      : undefined,
    signals: item.source_url
      ? (["meeting_today", "action_available"] as const)
      : (["meeting_today"] as const),
    sourceRefs: [`calendar:${String(item.metadata?.event_id ?? item.source_label ?? index)}`],
  }));
  return {
    source: "calendar",
    status: { source: "calendar", status: candidates.length ? "ok" : "empty", itemsCount: candidates.length },
    candidates,
  };
}

export function notionContextItemsToNewsroomSnapshot(
  items: WorkbenchRetrievedContext[],
): NewsroomSourceSnapshot {
  const candidates = items.slice(0, 6).map((item, index) => ({
    id: `notion-${index}`,
    title: cleanClaim(item.claim).replace(/^Working On:\s*/i, ""),
    reason: "This appears in your Workbench Notion context.",
    source: "notion" as const,
    confidence: "medium" as const,
    section: "today" as const,
    href: item.source_url ?? undefined,
    action: item.source_url
      ? { label: "Open Notion", target: "notion" as const, href: item.source_url }
      : undefined,
    signals: item.source_url
      ? (["active_work", "action_available"] as const)
      : (["active_work"] as const),
    sourceRefs: [`notion:${String(item.source_label ?? index)}`],
  }));
  return {
    source: "notion",
    status: { source: "notion", status: candidates.length ? "ok" : "empty", itemsCount: candidates.length },
    candidates,
  };
}

function cleanClaim(claim: string): string {
  const cleaned = claim.trim().replace(/\s+/g, " ");
  return cleaned.length > 92 ? `${cleaned.slice(0, 89)}...` : cleaned;
}
```

This keeps the live adapter calls aligned with the existing Workbench retrieval boundaries while the pure mapping helpers preserve the Newsroom snapshot contract.

- [ ] **Step 5: Run adapter tests**

Run: `npm test -- __tests__/newsroom-adapters.test.ts __tests__/newsroom-brief.test.ts`

Expected: PASS.

- [ ] **Step 6: Run TypeScript**

Run: `npx tsc --noEmit`

Expected: PASS. If the retrieval signatures differ from the plan, update only `loadCalendarNewsroomSnapshot` and `loadNotionNewsroomSnapshot` to match actual signatures.

- [ ] **Step 7: Commit Task 4**

```bash
git add __tests__/newsroom-adapters.test.ts lib/newsroom/adapters.ts
git commit -m "Connect Newsroom calendar and Notion adapters"
```

---

### Task 5: API Route

**Files:**
- Create: `app/api/newsroom/brief/route.ts`
- Test: `__tests__/newsroom-route.test.ts`

- [ ] **Step 1: Write failing route tests**

Create `__tests__/newsroom-route.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authWithApiKey: vi.fn(),
  generateNewsroomBrief: vi.fn(),
}));

vi.mock("@/lib/server-auth", () => ({
  authWithApiKey: () => mocks.authWithApiKey(),
}));

vi.mock("@/lib/newsroom/brief", () => ({
  generateNewsroomBrief: (...args: unknown[]) => mocks.generateNewsroomBrief(...args),
}));

import { GET } from "@/app/api/newsroom/brief/route";

beforeEach(() => {
  mocks.authWithApiKey.mockReset();
  mocks.generateNewsroomBrief.mockReset();
});

describe("GET /api/newsroom/brief", () => {
  it("rejects unauthenticated requests", async () => {
    mocks.authWithApiKey.mockResolvedValue(null);

    const res = await GET();

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthenticated" });
    expect(mocks.generateNewsroomBrief).not.toHaveBeenCalled();
  });

  it("returns the authenticated user's brief", async () => {
    const brief = {
      userId: "principal_123",
      generatedAt: "2026-04-30T09:00:00.000Z",
      range: { from: "2026-04-30T00:00:00.000Z", to: "2026-05-01T00:00:00.000Z" },
      today: [],
      changedSinceYesterday: [],
      needsAttention: [],
      suggestedNextActions: [],
      sourceStatuses: [],
    };
    mocks.authWithApiKey.mockResolvedValue({
      principalId: "principal_123",
      apiKey: "csk_test",
    });
    mocks.generateNewsroomBrief.mockResolvedValue(brief);

    const res = await GET();

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ brief });
    expect(mocks.generateNewsroomBrief).toHaveBeenCalledWith({
      userId: "principal_123",
      apiKey: "csk_test",
    });
  });
});
```

- [ ] **Step 2: Run route tests to verify failure**

Run: `npm test -- __tests__/newsroom-route.test.ts`

Expected: FAIL because `app/api/newsroom/brief/route.ts` does not exist.

- [ ] **Step 3: Implement API route**

Create `app/api/newsroom/brief/route.ts`:

```ts
import { NextResponse } from "next/server";
import { generateNewsroomBrief } from "@/lib/newsroom/brief";
import { authWithApiKey } from "@/lib/server-auth";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await authWithApiKey();
  if (!session?.principalId) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  const brief = await generateNewsroomBrief({
    userId: session.principalId,
    apiKey: session.apiKey,
  });

  return NextResponse.json(
    { brief },
    {
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );
}
```

- [ ] **Step 4: Run route tests**

Run: `npm test -- __tests__/newsroom-route.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit Task 5**

```bash
git add __tests__/newsroom-route.test.ts app/api/newsroom/brief/route.ts
git commit -m "Add Newsroom brief API"
```

---

### Task 6: Display Helpers And Newsroom UI

**Files:**
- Create: `components/newsroom/newsroom-display.ts`
- Create: `components/newsroom/newsroom-shell.tsx`
- Create: `app/(os)/newsroom/page.tsx`
- Modify: `lib/modules.ts`
- Test: `__tests__/newsroom-display.test.ts`, `__tests__/modules.test.ts`

- [ ] **Step 1: Write failing display and nav tests**

Create `__tests__/newsroom-display.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  deriveNewsroomEmptyMessage,
  sourceStatusLabel,
} from "@/components/newsroom/newsroom-display";
import type { NewsroomSourceStatus } from "@/lib/newsroom/types";

describe("Newsroom display helpers", () => {
  it("summarizes all-unavailable state without raw connector details", () => {
    const statuses: NewsroomSourceStatus[] = [
      { source: "calendar", status: "unavailable", reason: "token missing", itemsCount: 0 },
      { source: "notion", status: "unavailable", reason: "token missing", itemsCount: 0 },
    ];

    expect(deriveNewsroomEmptyMessage(statuses)).toBe(
      "Newsroom could not reach your context sources yet. Workbench setup may need attention.",
    );
  });

  it("uses a quiet source health label", () => {
    expect(sourceStatusLabel({ source: "review", status: "empty", itemsCount: 0 })).toBe(
      "Review empty",
    );
  });
});
```

Append to `__tests__/modules.test.ts`:

```ts
it("includes Newsroom as a staff-visible module before Workbench", () => {
  const newsroomIndex = MODULES.findIndex((module) => module.id === "newsroom");
  const workbenchIndex = MODULES.findIndex((module) => module.id === "workbench");

  expect(newsroomIndex).toBeGreaterThanOrEqual(0);
  expect(newsroomIndex).toBeLessThan(workbenchIndex);
  expect(moduleById("newsroom")?.adminOnly).toBeUndefined();
});
```

- [ ] **Step 2: Run tests to verify failure**

Run: `npm test -- __tests__/newsroom-display.test.ts __tests__/modules.test.ts`

Expected: FAIL because display helpers and module id do not exist.

- [ ] **Step 3: Implement display helpers**

Create `components/newsroom/newsroom-display.ts`:

```ts
import type { NewsroomSourceStatus } from "@/lib/newsroom/types";

export function sourceStatusLabel(status: NewsroomSourceStatus): string {
  const source = `${status.source[0].toUpperCase()}${status.source.slice(1)}`;
  if (status.status === "ok") return `${source} ${status.itemsCount}`;
  if (status.status === "empty") return `${source} empty`;
  if (status.status === "unavailable") return `${source} unavailable`;
  return `${source} error`;
}

export function deriveNewsroomEmptyMessage(
  statuses: NewsroomSourceStatus[],
): string {
  if (
    statuses.length > 0 &&
    statuses.every((status) =>
      ["unavailable", "error"].includes(status.status),
    )
  ) {
    return "Newsroom could not reach your context sources yet. Workbench setup may need attention.";
  }
  return "No major changes found for today. Workbench and Notion are ready when you need them.";
}
```

- [ ] **Step 4: Modify modules**

Update `lib/modules.ts`:

```ts
export type ModuleId =
  | "speak-to-charlie"
  | "forge"
  | "newsroom"
  | "workbench"
  | "cookbook"
  | "workforce"
  | "admin";
```

Insert Newsroom before Workbench in `MODULES`:

```ts
{
  id: "newsroom",
  label: "Newsroom",
  path: "/newsroom",
  accentVar: "var(--c-cornerstone)",
},
```

Update the workbench nav group:

```ts
{
  type: "group",
  id: "workbench",
  label: "Workbench",
  children: ["newsroom", "workbench"],
  accentVar: "var(--c-cowork)",
},
```

- [ ] **Step 5: Create route and client shell**

Create `app/(os)/newsroom/page.tsx`:

```tsx
"use client";

import { NewsroomShell } from "@/components/newsroom/newsroom-shell";

export default function NewsroomPage() {
  return <NewsroomShell />;
}
```

Create `components/newsroom/newsroom-shell.tsx` using CO OS shell styles:

```tsx
"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { NewsroomBrief, NewsroomItem } from "@/lib/newsroom/types";
import {
  deriveNewsroomEmptyMessage,
  sourceStatusLabel,
} from "./newsroom-display";

type BriefState =
  | { status: "loading" }
  | { status: "loaded"; brief: NewsroomBrief; dismissed: Set<string> }
  | { status: "error"; message: string };

export function NewsroomShell() {
  const [state, setState] = useState<BriefState>({ status: "loading" });

  const loadBrief = useCallback(async () => {
    setState({ status: "loading" });
    try {
      const res = await fetch("/api/newsroom/brief", { cache: "no-store" });
      const body = (await res.json()) as { brief?: NewsroomBrief; error?: string };
      if (!res.ok || !body.brief) {
        throw new Error(body.error ?? `Newsroom returned ${res.status}`);
      }
      setState({ status: "loaded", brief: body.brief, dismissed: new Set() });
    } catch (error) {
      setState({
        status: "error",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }, []);

  useEffect(() => {
    void loadBrief();
  }, [loadBrief]);

  const visible = useMemo(() => {
    if (state.status !== "loaded") return null;
    const keep = (item: NewsroomItem) => !state.dismissed.has(item.id);
    return {
      today: state.brief.today.filter(keep),
      changedSinceYesterday: state.brief.changedSinceYesterday.filter(keep),
      needsAttention: state.brief.needsAttention.filter(keep),
    };
  }, [state]);

  const dismiss = (id: string) => {
    setState((current) => {
      if (current.status !== "loaded") return current;
      return {
        ...current,
        dismissed: new Set([...current.dismissed, id]),
      };
    });
  };

  return (
    <div
      style={{
        height: "calc(100vh - var(--shell-h))",
        display: "grid",
        gridTemplateColumns: "minmax(0, 1fr) 380px",
        minHeight: 0,
      }}
    >
      <section style={{ display: "flex", flexDirection: "column", borderRight: "1px solid var(--rule)", minHeight: 0 }}>
        <header style={{ padding: "20px 28px 16px", borderBottom: "1px solid var(--rule)", display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ fontFamily: "var(--font-plex-mono)", fontSize: 10, letterSpacing: "0.18em", textTransform: "uppercase", color: "var(--ink-faint)" }}>
            Newsroom
          </div>
          <div style={{ fontSize: 13, color: "var(--ink-dim)" }}>
            Daily orientation
          </div>
          <div style={{ flex: 1 }} />
          <button type="button" onClick={() => void loadBrief()} style={{ fontFamily: "var(--font-plex-mono)", fontSize: 10, letterSpacing: "0.1em", textTransform: "uppercase", padding: "5px 9px", background: "var(--ink)", color: "var(--panel)", border: "1px solid var(--rule)" }}>
            Refresh
          </button>
        </header>

        <div style={{ flex: 1, overflow: "auto", padding: "18px 20px", display: "flex", flexDirection: "column", gap: 22 }}>
          {state.status === "loading" ? (
            <EmptyLine>Loading Newsroom…</EmptyLine>
          ) : state.status === "error" ? (
            <EmptyLine>Couldn&apos;t load Newsroom — {state.message}</EmptyLine>
          ) : visible ? (
            <>
              <NewsroomSection title="Today" items={visible.today} empty={deriveNewsroomEmptyMessage(state.brief.sourceStatuses)} onDismiss={dismiss} />
              <NewsroomSection title="Changed Since Yesterday" items={visible.changedSinceYesterday} empty="No meaningful changes found since yesterday." onDismiss={dismiss} />
            </>
          ) : null}
        </div>
      </section>

      <aside style={{ display: "flex", flexDirection: "column", background: "var(--panel)", minHeight: 0 }}>
        <header style={{ padding: "20px 24px 16px", borderBottom: "1px solid var(--rule)" }}>
          <div style={{ fontFamily: "var(--font-plex-mono)", fontSize: 10, letterSpacing: "0.18em", textTransform: "uppercase", color: "var(--ink-faint)" }}>
            Judgement
          </div>
        </header>
        <div style={{ flex: 1, overflow: "auto", padding: "18px 24px", display: "flex", flexDirection: "column", gap: 24 }}>
          {state.status === "loaded" && visible ? (
            <>
              <NewsroomSection title="Needs Attention" items={visible.needsAttention} empty="Nothing needs judgement right now." onDismiss={dismiss} />
              <ActionList brief={state.brief} />
              <SourceHealth brief={state.brief} />
            </>
          ) : null}
        </div>
      </aside>
    </div>
  );
}

function NewsroomSection({
  title,
  items,
  empty,
  onDismiss,
}: {
  title: string;
  items: NewsroomItem[];
  empty: string;
  onDismiss: (id: string) => void;
}) {
  return (
    <section>
      <h2 style={{ margin: "0 0 10px", fontSize: 16, fontWeight: 500 }}>{title}</h2>
      <div style={{ borderTop: "1px solid var(--rule)" }}>
        {items.length === 0 ? (
          <EmptyLine>{empty}</EmptyLine>
        ) : (
          items.map((item) => (
            <article key={item.id} style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) auto", gap: 16, padding: "14px 0", borderBottom: "1px solid var(--rule)" }}>
              <div>
                <div style={{ fontSize: 15 }}>{item.title}</div>
                <div style={{ marginTop: 5, fontSize: 13, lineHeight: 1.45, color: "var(--ink-dim)" }}>{item.reason}</div>
                <div style={{ marginTop: 8, fontFamily: "var(--font-plex-mono)", fontSize: 10, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--ink-faint)" }}>
                  {item.source} · {item.confidence}
                </div>
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "start" }}>
                {item.action ? (
                  <Link href={item.action.href} style={{ fontSize: 12, border: "1px solid var(--rule-2)", padding: "6px 9px", background: "var(--panel)" }}>
                    {item.action.label}
                  </Link>
                ) : null}
                <button type="button" onClick={() => onDismiss(item.id)} style={{ fontSize: 12, color: "var(--ink-dim)", border: "1px solid var(--rule)", padding: "6px 9px" }}>
                  Dismiss
                </button>
              </div>
            </article>
          ))
        )}
      </div>
    </section>
  );
}

function ActionList({ brief }: { brief: NewsroomBrief }) {
  return (
    <section>
      <h2 style={{ margin: "0 0 10px", fontSize: 16, fontWeight: 500 }}>Suggested Next Actions</h2>
      <div style={{ borderTop: "1px solid var(--rule)" }}>
        {brief.suggestedNextActions.length === 0 ? (
          <EmptyLine>No suggested actions.</EmptyLine>
        ) : (
          brief.suggestedNextActions.map((action) => (
            <Link key={`${action.target}:${action.href}:${action.label}`} href={action.href} style={{ display: "block", padding: "11px 0", borderBottom: "1px solid var(--rule)", fontSize: 14 }}>
              {action.label}
            </Link>
          ))
        )}
      </div>
    </section>
  );
}

function SourceHealth({ brief }: { brief: NewsroomBrief }) {
  return (
    <section style={{ marginTop: "auto", borderTop: "1px solid var(--rule)", paddingTop: 14 }}>
      <div style={{ fontFamily: "var(--font-plex-mono)", fontSize: 10, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--ink-faint)", marginBottom: 7 }}>
        Source health
      </div>
      <div style={{ fontSize: 12, color: "var(--ink-dim)", lineHeight: 1.7 }}>
        {brief.sourceStatuses.map(sourceStatusLabel).join(" · ")}
      </div>
    </section>
  );
}

function EmptyLine({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ padding: "12px 0", borderBottom: "1px solid var(--rule)", color: "var(--ink-dim)", fontSize: 13 }}>
      {children}
    </div>
  );
}
```

- [ ] **Step 6: Run display and module tests**

Run: `npm test -- __tests__/newsroom-display.test.ts __tests__/modules.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit Task 6**

```bash
git add __tests__/newsroom-display.test.ts __tests__/modules.test.ts components/newsroom/newsroom-display.ts components/newsroom/newsroom-shell.tsx app/'(os)'/newsroom/page.tsx lib/modules.ts
git commit -m "Add Newsroom surface"
```

---

### Task 7: Final Verification And Polish

**Files:**
- Modify only files already touched if verification reveals issues.

- [ ] **Step 1: Run full Newsroom test set**

Run:

```bash
npm test -- __tests__/newsroom-ranking.test.ts __tests__/newsroom-brief.test.ts __tests__/newsroom-adapters.test.ts __tests__/newsroom-route.test.ts __tests__/newsroom-display.test.ts __tests__/modules.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run TypeScript**

Run: `npx tsc --noEmit`

Expected: PASS.

- [ ] **Step 3: Run full test suite**

Run: `npm test`

Expected: PASS.

- [ ] **Step 4: Run lint**

Run: `npm run lint`

Expected: PASS or only pre-existing warnings. Do not introduce new lint errors.

- [ ] **Step 5: Run build**

Run: `npm run build`

Expected: PASS.

- [ ] **Step 6: Start dev server for manual UI check**

Run: `npm run dev`

Expected: server starts on `http://localhost:3000` or the next available port. Open `/newsroom` and verify:

- navigation shows Newsroom near Workbench
- two-pane layout matches the flat CO OS style
- Refresh works
- Dismiss removes an item locally
- source health is quiet
- unavailable sources do not break the page

- [ ] **Step 7: Commit final polish if any code changed**

If Step 1-6 required fixes:

```bash
git add app components lib __tests__
git commit -m "Polish Newsroom MVP"
```

If no fixes were needed, do not create an empty commit.

---

## Self-Review Notes

- Spec coverage: the plan covers route/navigation, shared model, API, aggregation, source adapters, ranking/de-dupe, UI, empty states, source failure handling, and tests.
- Known implementation risk: Workbench Calendar/Notion retrieval helper signatures may differ from the plan. Task 4 explicitly requires inspecting the current signatures and adapting only the live adapter calls while preserving tested snapshot helpers.
- Scope held out of MVP: durable dismiss/correct, heavy Drive scanning, manager/team mode, and deep Review Queue integration are excluded.
