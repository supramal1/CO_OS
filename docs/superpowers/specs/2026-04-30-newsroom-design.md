# Newsroom MVP Design

Date: 2026-04-30

## Product Intent

Newsroom is a new CO OS surface for daily orientation. It answers what changed, what matters, what needs judgement, and what the staff user should do next. It is not a feed, inbox, or dashboard. It should feel like a short operating brief that routes the user back into the right part of CO OS.

The MVP uses live adapters where CO OS already has reliable boundaries and returns explicit empty or unavailable states where the source is not ready. Calendar, Notion, Workbench run history, and Cornerstone should reuse existing Workbench/auth patterns. Review flags start as a lightweight adapter that can return no items or unavailable until the review source is formalized.

## Route And Navigation

Add a staff-visible `/newsroom` module under `app/(os)`.

Navigation should include Newsroom as a first-class OS surface, positioned before Workbench because the product flow is orientation before work. The module label is `Newsroom`, with an accent that fits the existing palette and does not introduce a loud new theme. If possible, group Newsroom with Workbench or place it next to Workbench without changing admin visibility rules.

The page must use the existing CO OS visual language more closely than the exploratory mockup:

- full-height module shell where appropriate
- flat panes and thin rules instead of decorative cards
- `var(--font-plex-mono)` uppercase metadata labels
- existing `var(--bg)`, `var(--panel)`, `var(--rule)`, `var(--ink*)` tokens
- restrained buttons matching Forge/Workbench patterns
- no marketing hero, oversized copy, or dashboard-heavy composition

## Data Model

Create shared Newsroom types in `lib/newsroom/types.ts`:

```ts
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
  source: "cornerstone" | "notion" | "calendar" | "workbench" | "review" | "forge";
  confidence: "high" | "medium" | "low";
  href?: string;
  action?: NewsroomAction;
};

export type NewsroomAction = {
  label: string;
  target: "workbench" | "review" | "notion" | "forge" | "calendar";
  href: string;
};

export type NewsroomSourceStatus = {
  source: NewsroomItem["source"];
  status: "ok" | "empty" | "unavailable" | "error";
  reason?: string;
  itemsCount: number;
};
```

`sourceStatuses` is included so the UI can show honest quiet provenance and useful empty states without exposing raw connector complexity.

## API

Add `GET /api/newsroom/brief`.

The route resolves the authenticated session with the existing Auth.js pattern. Unauthenticated users receive `401`. The authenticated principal id becomes `userId` for source reads and output ownership.

The response returns:

```ts
{ brief: NewsroomBrief }
```

The route should be dynamic and no-store. The MVP does not need persisted brief history, but the generator should keep deterministic structured output so persistence can be added later.

Optional future query params such as `date` and `mode` are not part of the first implementation unless they fall out naturally in tests. The generator should accept an injectable `now` so tests can cover date ranges without adding public params.

## Aggregation Layer

Create `lib/newsroom/brief.ts` as the aggregation boundary.

Core function:

```ts
export async function generateNewsroomBrief(input: GenerateNewsroomBriefInput): Promise<NewsroomBrief>
```

The generator:

1. Computes the local daily range for today and the previous-day comparison window.
2. Loads source snapshots from adapters.
3. Converts source records into candidate `NewsroomItem`s.
4. Scores and ranks candidates.
5. De-dupes similar items.
6. Keeps each section short by default.
7. Builds suggested next actions from the highest-value items with actions.
8. Returns honest source statuses even when some adapters fail.

Adapters should be narrow and testable. They should return structured snapshots, not UI copy. Candidate-to-brief generation owns prioritisation and wording.

## MVP Adapters

### Calendar

Use the existing Workbench Google Calendar client/token patterns. The MVP needs today’s meetings and, where cheaply available, recent changed meetings. Calendar output should support:

- Today items for upcoming meetings.
- Needs Attention when a meeting appears prep-heavy but has no linked active work context.
- Changed Since Yesterday when a calendar event has an updated timestamp or otherwise indicates a meaningful time change.

If Google Calendar access is missing, return `unavailable` instead of blocking the brief.

### Notion

Reuse existing Workbench Notion setup/token/client patterns. The MVP should read Workbench knowledge pages, especially Working On and Personal Profile where available. It should not create or mutate Notion pages.

Notion output should support:

- active projects/workstreams
- stale Working On signals when content is empty or old enough to be suspicious, if last-edited metadata is available
- provenance links back to Notion pages when available

If Notion is connected but pages are empty, return `empty` and show a useful empty state.

### Workbench

Reuse `listWorkbenchRuns` and existing run-history types. The MVP should inspect recent runs since yesterday, including ask text, result warnings, missing context, retrieved sources, and saved-output hints when available.

Workbench output should support:

- Today items for recent active work
- Changed Since Yesterday for new runs or saved outputs
- Needs Attention when warnings, missing context, or missing evidence are present
- actions routing to `/workbench`, or a run-specific URL if one exists

If run history storage is unavailable, return `unavailable` and continue.

### Review

Create a small adapter interface for review flags. For MVP, it may return no flags with `empty` or `unavailable`, depending on what current code exposes. This prevents Newsroom from hard-coding a future review implementation while preserving the model and UI slot.

Review output should eventually support unresolved feedback, missing-evidence flags, unresolved recommendations, and human-decision prompts.

### Cornerstone

Reuse the existing server-side Cornerstone retrieval pattern and session API key. Query for active project/client context and recent decisions using a concise Newsroom-oriented prompt. Cornerstone should enrich ranking and reasons, but it should not be required for the brief to render.

If Cornerstone errors or times out, return `error` in source status and continue.

## Ranking And De-Dupe

Add pure helpers in `lib/newsroom/ranking.ts`.

Ranking should promote items when:

- there is a meeting today
- unresolved review feedback exists
- a Workbench result has missing evidence or missing context
- a project appears in both Calendar and Notion
- something changed since yesterday
- the item requires human judgement
- the item has a clear action

Ranking should demote items when:

- confidence is low
- the item is only a generic update
- no action is available
- it is not linked to active work

De-dupe should merge candidates with similar normalized titles or shared source references. When merging, keep the stronger confidence, combine provenance conservatively, and prefer action-bearing items.

Section limits for MVP:

- Today: 3 items
- Changed Since Yesterday: 4 items
- Needs Attention: 4 items
- Suggested Next Actions: 4 actions

## UI

Create a `NewsroomShell` client component under `components/newsroom/newsroom-shell.tsx`.

The shell fetches `/api/newsroom/brief` on load and renders:

- Today
- Changed Since Yesterday
- Needs Attention
- Suggested Next Actions
- quiet source health/provenance

Each item displays:

- title
- short reason
- source/provenance label
- confidence label where useful
- action button when available

Interactions:

- `Refresh` reloads the brief.
- `Dismiss` can be client-only for MVP if a durable dismissal store is not already cheap. It removes the item from the local view only.
- `Correct` can route to the relevant source where possible, or be omitted until there is a real correction destination. Do not fake correction persistence.

Empty states:

- If all sources are unavailable, show a clear operational empty state.
- If sources are connected but there is no context, show a concise staff-facing message such as: `No major changes found for today. Workbench and Notion are ready when you need them.`
- Per-section empty states should be one line, not large panels.

### Changed Since Yesterday Quality Bar

`Changed Since Yesterday` should not render raw Cornerstone fact keys, commit logs, branch names, local worktree paths, or implementation archaeology. It should translate source-backed facts into a short operating brief.

The approved MVP presentation is a hybrid of narrative orientation and judgement routing:

- one narrative item headed by the actual change, not a generic label
- one short paragraph that explains what changed in staff/product terms
- a compact `Worth looking at` area for follow-up judgement or setup issues tied to those changes
- quiet provenance showing the source and confidence

Example shape:

```text
Workbench and Newsroom moved closer to daily staff use
Workbench gained a clearer context-needed resume flow, staged make/review handling, and stronger second-brain setup rules. Newsroom now uses Cornerstone facts to explain what changed without exposing graph memory or raw implementation logs.

Worth looking at
- Connector setup: Calendar and Notion still need connection/setup resolution before Newsroom can fully orient the day.
- Brief quality: Keep translating implementation facts into product meaning, not branch names or paths.
```

The summary generator should prefer fact values over fact keys, strip noisy implementation details, and group related changes into a small set of product-level themes. The UI can render newline-separated reason text as compact rows inside the item rather than one dense paragraph.

## Error Handling

Source failures must not fail the whole brief unless authentication fails. Each adapter should catch and report its own status. The API returns `200` with partial source statuses when one source fails.

The UI should avoid raw error dumps. Staff-facing copy should say what is affected and what still worked. Developer details can remain in the API response only where existing route patterns already expose detail.

## Testing

Add focused Vitest coverage:

- brief generation combines source snapshots into the four MVP sections
- ranking promotes meetings, review flags, missing evidence, and cross-source project matches
- de-dupe removes duplicate candidate items while preserving actions
- empty/unavailable source statuses still produce a valid brief
- API route rejects unauthenticated requests
- API route returns the generated brief for an authenticated principal
- UI helper tests for item/source display states if the shell extracts pure display helpers

Use test-first implementation for the aggregation and route behavior. UI rendering can be tested through pure helper functions unless the repo already has a React component test pattern for this surface.

## Out Of Scope For MVP

- digest email or Slack-style delivery
- manager or team mode
- heavy Drive scanning
- durable dismiss/correct persistence unless an existing table makes it trivial
- complex Newsroom settings
- deep Review Queue integration before a stable review flag source exists
- Forge monitoring updates beyond preserving the action target type

## Acceptance Criteria

Newsroom MVP is complete when a staff user can open `/newsroom` and see:

- today’s meetings and work items where available
- meaningful changes since yesterday
- items needing attention or judgement
- next actions routing into Workbench, Review, Notion, Forge, or Calendar where available
- simple provenance/source labels
- useful empty states when context is missing or connectors are unavailable

The product should feel like: `Here is what matters today, and here is where to go next.`
