# Workforce Night 2 — Handoff from Night 1

**Branch:** `workforce-night1` → ready to merge into `master` once UI smoke passes.
**Status:** Functional dogfood UI shipped. Pixel office is Night 2's job.

This doc is for whoever picks up Night 2 (probably Mal + a fresh Claude
session). It maps the Night-1 surface to what Night 2 should keep,
replace, or build on top of.

---

## What Night 1 actually shipped

### Substrate (lives in CO_OS now)

The v0 substrate moved into `packages/workforce-substrate/`. Imports
resolve via tsconfig path alias (`"@workforce/substrate"`) and Next's
`transpilePackages` + webpack `extensionAlias` lets the bundler resolve
NodeNext-style `.js` specifiers against the raw `.ts` source files. No
build step, no npm publish. Substrate-level tests still run via
`npx vitest run` from the package directory — 42/42 passing.

### HTTP API (`app/api/workforce/*`)

| Route | Purpose |
|---|---|
| `POST /tasks` | Dispatch — auth-gated to admin; returns 202 with `taskId`, `eventStreamUrl`, `statusUrl` |
| `GET /tasks?limit=N` | Recent tasks for the principal — merges in-memory registry + DB rows |
| `GET /tasks/[id]` | Single task detail (state, cost, duration, events, output, children) — DB fallback if not in registry |
| `POST /tasks/[id]/cancel` | Cooperative cancel via `AbortController` |
| `GET /tasks/[id]/events` | Server-Sent Events stream — replays cached events, subscribes to bus, 15s heartbeat, "end" frame on terminal |
| `GET /agents` | Public roster (no system prompts, no tool builders) |
| `GET /health` | Roster validation + inflight count |

All routes auth via `getServerSession`; admin gate via
`session.isAdmin`; Cornerstone-resolved per-principal `csk_*` key
threaded through the runner.

### Persistence (`lib/workforce/persistence.ts`)

Supabase tables (`workforce_tasks`, `workforce_task_events`,
`workforce_task_results`) — schema in migration `workforce_v0_tables`.
Writes are fire-and-forget, swallow errors with a `console.warn`. If
`SUPABASE_SERVICE_ROLE_KEY` is empty, persistence silently no-ops and
the runner stays usable in-memory only.

### SSE pub/sub (`lib/workforce/bus.ts`)

Per-task `EventEmitter` map. Single-process — fine for Night 1
dogfood (single user, single Next instance). For multi-instance
Cloud Run we'll need Postgres LISTEN/NOTIFY or Redis. Documented in
`runner.ts` as the upgrade path.

### Functional UI (`components/workforce/*`, `app/(os)/workforce/*`)

Two-column dispatch shell + single-task detail view. Uses existing
CO_OS design tokens (`var(--ink)`, `var(--c-cornerstone)` etc.) — no
new UI deps. State chip colors map to the substrate's invocation
states. Markdown rendering via `react-markdown` + `remark-gfm`.

### Grace's GitHub tools

`packages/workforce-substrate/src/integrations/github.ts`. Pure REST
API, no shell-out. 14-tool surface (10 allowed, 4 mounted-but-blocked).
Branch namespace enforcement at the tool layer. Multi-file atomic
commits via the git-data API. PAT-authenticated, org-pinned. Smoke
script at `bin/smoke-github.ts` — pre-verified 13/13 against
Forgeautomatedrepo on 2026-04-27.

---

## What Night 2 should KEEP

Don't rewrite these — they're load-bearing, well-tested, and pixel
office is purely additive on top.

1. **The HTTP API surface.** Pixel office should consume the same
   `/api/workforce/*` routes the dogfood UI uses. Adding new routes
   for animation state belongs *next to* the existing ones, not as
   a replacement.

2. **The substrate.** It's the canonical workforce contract. Pixel
   office is a presentation layer.

3. **The runner bridge (`lib/workforce/runner.ts`).** The
   `InMemoryEventLog.onEmit` hook is the clean integration point —
   pixel office can subscribe to the same SSE stream the dogfood UI
   uses without modifying anything substrate-side.

4. **Persistence schema.** Pixel office may need new columns for
   animation state — add them in a follow-up migration, don't change
   the existing tables. The current tables intentionally store the
   minimum to reconstruct invocation history.

5. **Grace's GitHub tools.** Surface is locked per the Phase 5
   decision doc + the deviation notes. If pixel office wants to
   show "Grace is working in repo X" the data is already in the
   event log (`tool_called` payloads) — no schema change needed.

---

## What Night 2 should REPLACE

Pixel office replaces the dogfood UI. The dogfood UI was always
disposable — it's what made Night 1 possible to dogfood without
blocking on the visual layer.

- `components/workforce/workforce-shell.tsx` — replaced by pixel
  office shell.
- `components/workforce/recent-tasks-list.tsx` — replaced by the
  pixel office's task carousel / room view / whatever.
- `components/workforce/task-input.tsx` — replaced by the dispatch
  UX in pixel office.
- `components/workforce/task-detail-view.tsx` — replaced by the
  per-task animation room.
- `components/workforce/state-chip.tsx` — probably replaced by
  per-agent character-state animations.
- `app/(os)/workforce/layout.tsx`, `page.tsx`,
  `tasks/[id]/page.tsx` — replaced by pixel office routes.

**Deletion plan:** Don't delete on day one. The dogfood UI is your
escape hatch — keep it under `/workforce/legacy` or behind a feature
flag until pixel office is at parity. Once pixel office passes its
own smoke, delete the legacy components in a follow-up commit.

---

## Where pixel office hooks into persistence (animation state)

If pixel office needs per-task animation state (which character is in
which room, animation timing, lerp positions, etc.), the cleanest
place to put it is a sibling table:

```sql
create table workforce_task_animation (
  task_id uuid primary key references workforce_tasks(task_id) on delete cascade,
  scene jsonb not null,         -- last known scene state blob
  updated_at timestamptz default now()
);
```

Reasons:

- Doesn't pollute `workforce_tasks` (which is the substrate's
  canonical record).
- Pixel-office-specific schema can evolve independently.
- FK + on-delete cascade keeps cleanup simple.

Update path: pixel office subscribes to the same SSE channel the
dogfood UI uses. When a `tool_called` / `delegate_initiated` /
`task_completed` event arrives, pixel office updates its scene state
client-side AND writes the new scene to
`workforce_task_animation` via a new `POST /api/workforce/tasks/[id]/scene`
route. On reload, the route GETs the last scene to avoid the "blank
office" flash.

Do NOT push animation state through `workforce_task_events` — that
table is for the substrate's invocation truth (model turns, tool calls,
delegations). Cluttering it with frame-level UI state would make the
event log unreadable for debugging.

---

## Brief deviations to call out at the merge review

1. **Substrate origin.** Brief assumed substrate lived in
   `paperclip-eval`. It actually lived in `co-os/packages/workforce-
   substrate/` already — built directly here. No migration was
   needed; P1 collapsed into a verify-and-document step.

2. **Grace tool surface.** Decision doc listed `clone_repo`,
   `write_file (local)`, `delete_file (local)`, `commit_changes`,
   `push` as separate tools modeling a local working copy paradigm.
   Implementation collapsed those into `github_commit_files`
   (atomic git-data API commit) for cleaner history and stateless
   tool calls. Net surface is 14 tools (10 allowed, 4 forbidden).
   Full deviation table in
   `docs/grace-github-tools-decisions.md`.

3. **Grace prompt update.** Drafted at
   `docs/grace-prompt-patch-draft.md`. Not shipped to Cookbook —
   per anti-goal "no agent prompt mods beyond Grace's GitHub
   addition, and that needs Mal approval".

4. **P7 scope.** Mal-driven UI smoke (3 scenarios) intentionally
   left for Mal to run against his session. The GitHub tool
   layer was pre-verified autonomously (13/13 against live
   GitHub) so the riskiest new code is proven before the UI
   smoke runs.

---

## Operational notes

- `paperclip-eval` is now deprecated as a workforce source. Anything
  in that repo is reference-only. The active substrate is here.
- `MEMORY_API_KEY` (legacy shared key) is rejected by Cornerstone in
  governance mode. Per-principal `csk_*` keys via
  `CORNERSTONE_API_KEY` are the only path. Already documented in
  Mal's memory under `project_cornerstone_governance_mode`.
- Shell `printenv` overrides `.env.local` silently — first thing to
  check when auth fails despite the file looking right.
  (`feedback_nextjs_env_precedence` for context.)

---

## Suggested first commit on `night2`

A `feat(co-os/workforce): pixel-office shell scaffold` commit that:

1. Creates `app/(os)/workforce/(pixel)/` route group.
2. Imports the existing `WorkforceShell` under `legacy/` so both
   work in parallel.
3. Adds a feature flag (env var or session field) to toggle which
   shell renders at `/workforce`.

That gives Night 2 a safe place to iterate without breaking the
dogfood path Mal will be using day-to-day.
