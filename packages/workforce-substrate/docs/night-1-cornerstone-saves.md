# Cornerstone facts to save after Night 1 closes

Run these from your shell (Claude Code or any MCP client) once the
UI smoke (`co-os-smoke-runbook.md`) has passed. Each fact is atomic,
dated, and uses a stable searchable key — matches the
`cornerstone-usage.md` rules.

Save them in your default workspace (Mal personal). Cornerstone-
infrastructure detail is fine here; do NOT save these in client
workspaces.

---

## 1 — Substrate moved into CO_OS

```
add_fact(
  key="co_workforce_substrate_in_co_os",
  value="2026-04-27 — Workforce v0 substrate lives at packages/workforce-substrate/ inside CO_OS. Imported via tsconfig path alias '@workforce/substrate'; Next bundles via transpilePackages + webpack extensionAlias mapping .js → .ts. No build step, no npm publish. 42/42 vitest tests passing. paperclip-eval substrate is deprecated as a source.",
  category="workforce"
)
```

## 2 — HTTP API surface complete

```
add_fact(
  key="co_workforce_co_os_http_api_complete",
  value="2026-04-27 — CO_OS exposes /api/workforce/* covering dispatch (POST tasks), list, detail, cancel, SSE event stream (/tasks/[id]/events), agents, health. Auth via NextAuth + per-principal csk_* keys; admin-gated. Returns 202 on dispatch with eventStreamUrl + statusUrl. Health endpoint returns rosterValid + 5 agents + leadId=ada.",
  category="workforce"
)
```

## 3 — Persistence layer complete

```
add_fact(
  key="co_workforce_co_os_persistence_complete",
  value="2026-04-27 — Workforce tasks persist to Supabase project bksxovxcbescoytwmghq via service-role key. Tables: workforce_tasks, workforce_task_events, workforce_task_results (FK cascade, RLS off). Writes are fire-and-forget with console.warn fallback; runner stays usable in-memory if SUPABASE_SERVICE_ROLE_KEY is absent. Reads merge live registry + DB rows so /api/workforce/tasks survives process restart.",
  category="workforce"
)
```

## 4 — Grace GitHub tools live

```
add_fact(
  key="co_workforce_co_os_grace_github_tools_live",
  value="2026-04-27 — Grace has a 14-tool GitHub surface (10 allowed, 4 mounted-but-blocked). Pure REST API via fetch — no shell-out, no working dir. Atomic multi-file commits via git-data API (blob → tree → commit → ref). PAT-auth, scoped to Forgeautomatedrepo. Branch namespace 'grace/' enforced at tool layer. Mal merges via GitHub UI; github_merge_pr returns permission_denied. Prompt patch drafted but Cookbook update is Mal-approval-gated.",
  category="workforce"
)
```

## 5 — Night 1 complete (save LAST, after the UI smoke passes)

```
add_fact(
  key="co_workforce_night1_complete",
  value="2026-04-27 — Night 1 of 2 closed. Workforce-night1 branch shipped: substrate migration (verify-and-document), HTTP API surface, Supabase persistence, minimal functional UI (dispatch + live task view), Grace GitHub tools (live-smoked 13/13 against Forgeautomatedrepo). UI smoke passed under Mal session for all three scenarios (Donald audit, Ada→Margaret research, Ada→Grace repo creation). Night 2 plan: pixel office shell on top of the existing API + persistence; legacy dogfood UI moves under /workforce/legacy until pixel office reaches parity. Handoff doc at packages/workforce-substrate/docs/night-2-handoff.md.",
  category="workforce"
)
```

---

## Smoke-pass fact (template — fill in actual results)

If something failed in the UI smoke, replace this with what actually
happened so future-you doesn't trust a green light that wasn't:

```
add_fact(
  key="co_workforce_co_os_smoke_complete",
  value="2026-04-27 — All three Night-1 UI smoke scenarios passed in CO_OS workforce dispatch. Donald audit returned [N] duplicate clusters. Margaret returned a 3-paragraph briefing with [N] sources. Grace created Forgeautomatedrepo/co-night1-handoff with grace/ branch + README + open PR #[N]. Total cost: $[X]. Total duration: ~[Y]s end-to-end. No SSE drops, no namespace violations, no stuck states.",
  category="workforce"
)
```

---

## Why these specific 5 (and not more)

Per `cornerstone-usage.md`: facts must be atomic. These five each
cover one topic — substrate location, API surface, persistence, Grace
tools, sprint completion. Combining them would violate the
atomicity rule and make later updates ("we changed the persistence
layer") destroy unrelated context.

Skipping any of them is OK if the underlying state changes — e.g. if
Night 2 replaces the API surface, the Night-2 conversation should
update the `co_workforce_co_os_http_api_complete` fact rather than
creating a new one.
