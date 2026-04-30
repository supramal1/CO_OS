# Workbench V1 Phase 1 Investigation

Date: 2026-04-29
Repo inspected: `/Users/malik.james-williams/co-os`

## Required Context Read Status

Cookbook context was readable through production Cookbook MCP `get_skill`. I read `workbench-preflight`, `writing-style`, `how-to-use-cornerstone`, and `claude-code-brief-checklist`.

Phase 1 review correction: Workbench V1 should use the Cornerstone `default` namespace, not `co_workbench_mal`. Invocation logs must include `user_id` so a future split to `co_workbench_[user]` is a filtered migration. My earlier `co_workbench_mal` direct REST check returned zero facts, notes, sessions, and context, which now matches the corrected instruction that V1 design context lives in `default`.

## 1. Cowork Integration Shape

### Finding

`co-os` is the active CO OS shell and includes Speak to Charlie, Forge, Workforce, Cookbook, Admin, and Cornerstone surfaces. I found no Workbench implementation and no slash command router, plugin registry, MCP adapter, or Cowork command config in this repo. Search hits for Cowork are only a CSS token in `app/globals.css`, a historical note in `packages/workforce-substrate/DEMOLITION-LIST.md`, and a stashed Cornerstone page comment. I also did not find a separate Cowork repo under `/Users/malik.james-williams` at depth 2. The Cowork repo path is still needed to answer the exact integration mechanism.

### Recommendation

Build Workbench as a `co-os` module with its own chat surface and backend, exposed as a new CO OS tab in the same repo. The backend holds `ANTHROPIC_API_KEY`, loads skills from Cookbook using `get_skill`, and runs direct Anthropic calls with those skill bodies as system prompts. Mirror the Workforce substrate pattern in `packages/workforce-substrate/src/cookbook.ts`: skills are pure prompts in Cookbook, orchestration is code in `co-os`, and there is no native skill runtime inside `co-os`.

Cowork should integrate as an adapter onto the same backend once the Cowork repo is available. If Cowork is a Claude Desktop style custom MCP, expose wrapper tools named `workbench_start` and `workbench_check`. If Cowork has native slash-command config, wire `/start` and `/check` to the same `co-os` routes. This keeps product logic in one module and keeps Cowork replaceable.

### Rough Effort

0.5 day after the Cowork repo path is provided to confirm the command mechanism and write the adapter plan. 1 day if the adapter is a new MCP server rather than a config-only slash command.

## 2. Skill Invocation Pattern

### Finding

`co-os` already has a Cookbook MCP client in `lib/cookbook-client.ts` with `getSkill`, `createSkill`, `updateSkill`, and `testSkill`. The Workforce substrate uses the same pattern in `packages/workforce-substrate/src/cookbook.ts`: it loads skill bodies through `get_skill` and then calls Anthropic directly. `test_skill` is useful for manual validation, but it only accepts `{ name, prompt }`, returns a single response, and does not expose the model routing needed for Pre-send's Haiku rubric pass plus Sonnet manager-pushback pass.

### Recommendation

Use Cookbook MCP `get_skill` for versioning, scope checks, and permissioning, then run direct Anthropic calls in the orchestrator. For Pre-flight, load `workbench-preflight` and call Sonnet directly with retrieved context plus a strict JSON schema instruction. For Pre-send, load `workbench-presend`, run the rubric checks on Haiku, then run the manager-pushback section on Sonnet. Cache skill bodies per process with a short TTL, for example 5 minutes, and include the skill version in invocation logs.

### Rough Effort

0.5 day for a small skill loader, model router, JSON parser, and tests. Add another 0.25 day if we include schema validation and a single retry on invalid JSON.

## 3. Notion Retrieval Performance

### Finding

I could not measure Notion retrieval latency during Phase 1 because Notion MCP was not available at the time of investigation. Notion MCP is now expected before Phase 2 starts. There is still no Notion-related environment variable or client code in `co-os`.

### Recommendation

Day 1 of Phase 2 should run a real benchmark before cache design. Fetch the five Workbench pages plus parent in parallel, run 10 cold passes and 10 warm passes, and report median, p95, min, max, and failure count. Only then choose the caching layer. Source traces should use Notion page URLs and block anchors where possible.

### Rough Effort

0.5 day for the benchmark harness and report. 1 day to implement the adapter, page normalizer, source links, and the cache shape selected from measured data.

## 4. Calendar Semantic Match

### Finding

The available Google Calendar connector supports bounded event search and availability, but not semantic search. Its search tool exposes a broad free-text `query` and explicitly describes it as keyword search, best for title and indexed text matching. It does not accept embeddings, semantic filters, or an ask string with ranking semantics.

### Recommendation

Preprocess the ask into calendar search keys before querying Calendar. Use a cheap model call or deterministic extractor to produce 3 to 5 terms: client, project, requester, likely meeting topic, and date hints. Run bounded keyword searches over the next 14 days in parallel. If those return nothing, fetch a small page of events from the same 14 day window without a query and locally rank titles, descriptions, and attendees against the ask. Every retained calendar item must carry event ID, title, time, and a Calendar URL or stable event reference.

### Rough Effort

0.5 day for extractor, parallel search, fallback scan, local ranking, and source-shaped output. More if we need OAuth scopes beyond the current Calendar connector.

## 5. Hours-Saved Baseline

### Finding

There is no Workbench invocation log or baseline table yet. Existing Workforce cost estimation is spend-oriented and not suitable as the Workbench hours-saved baseline. The Workbench loop needs stable weekly aggregation, so per-task freeform model estimates alone will drift too much for a demo metric.

### Recommendation

Use stored heuristics by `task_type` as the baseline, with model-assisted classification at invocation time. V1 can ship with a small hardcoded table, for example `deck_scaffold`, `doc_scaffold`, `email_draft`, `draft_check`, and `ask_decode`, each with `estimated_time_before_minutes`. Let Sonnet classify the task type and optionally apply a simple complexity multiplier, but persist the final number in the invocation log. Capture `observed_time_after` from the task-done hook, defaulting to elapsed active time only when the user does not provide a value. Weekly aggregation should sum `before - after` by task type.

### Rough Effort

0.5 day for schema, baseline table, logging helper, done-hook update, and weekly Markdown or JSON aggregation.

## 6. Scaffold Output Generation Approach

### Finding

`co-os` has no docx, pptx, Google Drive, Google Sheets, Calendar, or Notion connector code today. `package.json` does not include `docx`, `pptxgenjs`, `googleapis`, or an OAuth token persistence layer. Google sign-in currently uses NextAuth Google only for identity. The session resolves a Cornerstone principal and API key, but it does not store Google access tokens, refresh tokens, or Drive/Sheets/Calendar scopes.

There is no docx/pptx skills runtime available in the `co-os` backend environment. The local Superpowers writing-skills docs mention docx-js and pptxgenjs as authoring patterns, but that is guidance, not a callable runtime. Current npm metadata shows `docx` 9.6.1 and `pptxgenjs` 4.0.1 are MIT-licensed TypeScript-friendly packages.

Drive and Gmail MCP tools are not exposed to this Codex session. Even if they were, using MCP tools from the `co-os` backend would not naturally align with the authenticated app session or the per-user Workbench output folder. Google Drive API supports `files.create` with upload and `drive.file` scope. Calendar is required in V1 for 14-day task-context retrieval. Notion is required in V1 as the user's knowledge store. Gmail is explicitly not V1 and is deferred to V1.5 because `gmail.compose` adds sensitive OAuth consent surface.

### Options Reviewed

Option A: Anthropic docx/pptx skills via a skills runtime. Not recommended for V1. There is no confirmed skills runtime in `co-os`, and depending on one would blur the confirmed architecture: skills are prompts in Cookbook, orchestration is code in `co-os`.

Option B: Native TypeScript generators using `docx` and `pptxgenjs`, plus native Google connectors. Recommended. Generate DOCX and PPTX scaffold buffers in-process, then upload them to the user's configured Drive folder. Generate Sheets using Google APIs and place the created spreadsheet in the same folder. Calendar retrieval supports task-context search. Notion stores and retrieves the user's Workbench knowledge base. Gmail draft creation is deferred to V1.5. This keeps scaffold behavior deterministic, testable, and independent of prompt drift.

Option C: Hybrid with skills for Office files, Drive MCP for Sheets, and Gmail MCP for emails. Not recommended as stated. It splits output behavior across three auth surfaces, makes source and permission handling harder, and would force the app backend to depend on MCP sessions that are not part of the `co-os` user session.

### Recommendation

Choose Option B, with first-party Google Drive, Sheets, Calendar, and Notion connectors in `co-os`. Defer Gmail to V1.5.

Add a `user_workbench_config` table keyed by authenticated `user_id`:

```sql
create table user_workbench_config (
  user_id text primary key,
  notion_parent_page_id text not null,
  drive_folder_id text not null,
  drive_folder_url text not null,
  google_oauth_grant_status text not null default 'pending',
  google_oauth_scopes text[] not null default '{}',
  voice_register text,
  feedback_style text,
  friction_tasks text[],
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
```

The first-run Workbench experience writes this config. The backend reads `user_id` from the authenticated `co-os` session, never from a hardcoded value. Each output call resolves the user's Drive folder from `user_workbench_config`, generates or creates the artifact server-side, uploads or places it in Drive, and returns a source-linked artifact reference to chat.

For Google output, add OAuth scopes and token persistence deliberately rather than piggybacking on the current identity-only login. Minimum V1 target: `drive.file`, `spreadsheets`, and `calendar.readonly`. Store refresh tokens server-side, encrypted or in the existing secure secret store pattern, and never expose Google tokens to the browser. Do not request `gmail.compose` in V1.

### Rough Effort

2 days for DOCX and PPTX native scaffold generators with tests. 1 to 1.5 days for Drive upload connector, OAuth scope handling, and `user_workbench_config`. 1 day for Sheets creation and row prefilling. 0.5 day for Calendar keyword extraction and retrieval. Notion adapter/cache effort is separate from Google connector effort.

## Phase 1 Review Updates To Phase 2 Brief

- Cornerstone namespace: use `default` for V1. Every invocation log includes `user_id`.
- Notion: run the 10 cold plus 10 warm parallel-fetch benchmark on day 1 of Phase 2 before designing cache behavior.
- Identity and config: no hardcoded `user_id`. Pull the authenticated `co-os` session user and read per-user Notion and Drive settings from `user_workbench_config`.
- Architecture: Workbench is a `co-os` module with its own chat surface and backend. Cookbook skills are prompt bodies loaded through `get_skill`; direct Anthropic calls do execution.
- Connectors: build first-party Google Drive, Sheets, Calendar, and Notion connectors inside `co-os`. Do not rely on MCP as the backend output path. Gmail is V1.5, not V1.
- Surface: Workbench is a new CO OS tab, not a separate app or external runtime.

## Build Blockers Before Phase 2

- Provide the Cowork repo path or confirm Cowork is Claude Desktop plus custom MCP.
- Confirm default-namespace Workbench design facts are the canonical V1 source.
- Ensure Notion MCP is available for the day 1 benchmark.
- Provide the initial Workbench Notion parent page ID and Drive folder ID through `user_workbench_config`, not code.
- Keep Gmail out of V1; revisit `gmail.compose` consent copy and draft-only safeguards in V1.5.
- Approve the deploy plan before any `create_skill` call or production push.
