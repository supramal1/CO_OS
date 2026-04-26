# CO_OS Workforce — Night 1 Smoke Runbook

**Audience:** Mal (driving the smoke from the dispatch UI).
**Purpose:** Three end-to-end scenarios that verify the v0 substrate
running inside CO_OS works under your live session — your Cornerstone
key, your Anthropic credits, your GitHub PAT for Grace.

---

## Pre-flight (90 seconds)

1. **Shell env** — make sure `.env.local` is the source of truth (no
   stale shell exports). If `printenv | grep CORNERSTONE_API_KEY`
   shows a different value than what's in `.env.local`, fix the shell
   before doing anything else (this has burned us before — see
   `feedback_nextjs_env_precedence`).
2. **Service-role key** — confirm
   `SUPABASE_SERVICE_ROLE_KEY` is populated in `.env.local`. As of the
   Night-1 commit it was an empty placeholder. Without it, persistence
   silently no-ops; tasks won't survive a process restart and won't
   show up in `/api/workforce/tasks` after the runner is bounced.
   Paste the value from the Supabase dashboard if it's blank.
3. **Boot the dev server**: `npm run dev` (default port 3000 — keep it
   on 3000 because `NEXTAUTH_URL` in `.env.local` points there).
4. **Sign in** at `http://localhost:3000` via Google. Your session
   resolves to your `csk_*` Cornerstone key automatically.
5. **Sanity** — `curl http://localhost:3000/api/workforce/health`
   should return `{ ok: true, rosterValid: true, agentCount: 5,
   leadId: "ada" }`.

If the health check fails, stop and triage before running the
scenarios — the substrate is not loaded.

---

## Scenario 1 — Donald audit (the cheapest test)

**Why first:** Donald uses Cornerstone read tools + steward_inspect.
No delegation, no GitHub, no third-party APIs. If this breaks, the
problem is the substrate-CO_OS integration, not the workforce.

**Dispatch UI:**

| Field | Value |
|---|---|
| Lead | Ada |
| Workspace | `aiops` |
| Task | `Ask Donald to run a Cornerstone duplicate-fact audit of the aiops workspace and surface the top 3 candidate clusters with reasoning. Final output: markdown summary.` |

**Expected:**
- Ada delegates to Donald via `delegate_task` (event:
  `delegate_initiated` → child task appears in detail view).
- Donald calls `steward_inspect` with `operation: duplicates`,
  possibly `list_facts` to enrich.
- Donald returns a markdown summary; Ada returns it as final output.
- Cost: a few cents.
- Stream state: `connecting` → `live` → `closed` over ~30-90 seconds.

**Pass criteria:**
- Final output is a markdown document with at least one duplicate
  cluster identified.
- Event log shows the full delegation tree (Ada start, delegate to
  Donald, Donald's tool calls, Donald complete, Ada complete).
- Cost > $0.00 (proves Anthropic billing is wired).

**Failure modes to watch for:**
- **401 Cornerstone**: shell env precedence issue (see pre-flight 1).
- **No events streaming**: SSE not connecting — check browser console
  for EventSource errors.
- **Task stuck in "connecting"**: bus.ts pub/sub mismatch; check the
  Next dev server log.

---

## Scenario 2 — Ada delegates to Margaret

**Why second:** Verifies a delegation that touches a different
specialist (research) and exercises Anthropic's web_search tool.

**Dispatch UI:**

| Field | Value |
|---|---|
| Lead | Ada |
| Workspace | `aiops` |
| Task | `Ada — ask Margaret to research the current state of voice cloning detection (focus: 2026 academic + commercial tooling, not 2024 hype). Margaret should return a 3-paragraph briefing with at least 3 sources cited.` |

**Expected:**
- Ada delegates to Margaret.
- Margaret calls `web_search` (server-side managed by Anthropic, no
  local dispatch — events show `tool_called: web_search` followed by
  `tool_returned: ok`).
- Margaret returns a structured briefing; Ada returns it.
- Cost: ~$0.05–0.20 (web_search adds tokens).

**Pass criteria:**
- Output cites real 2026 sources (URL + brief title).
- No `web_search_local_dispatch` errors (the safety-net only fires
  when Anthropic mis-routes).
- Total turns < 16 (default limit; Margaret should not loop).

---

## Scenario 3 — Grace creates a repo via Ada delegation

**Why last:** This is the highest-risk scenario because it's the only
one with a real-world side effect (a repo gets created in
`Forgeautomatedrepo`). The GitHub tool layer was pre-verified by
`bin/smoke-github.ts` — see `co-substrate-smoke-2026-04-26-*` repo
which Grace created end-to-end before this smoke ran.

**Dispatch UI:**

| Field | Value |
|---|---|
| Lead | Ada |
| Workspace | `aiops` |
| Task | `Ada — ask Grace to create a private repo named co-night1-handoff in the Forgeautomatedrepo org. Have Grace create a grace/ branch, commit a README.md describing CO_OS Workforce v0 in 3 paragraphs, then open a PR back to main. Final output: the PR URL.` |

**Expected:**
- Ada delegates to Grace.
- Grace calls (in order, roughly): `github_create_repo`,
  `github_get_repo`, `github_create_branch`, `github_commit_files`,
  `github_open_pr`.
- Grace returns the PR URL.

**Pass criteria:**
- Repo `Forgeautomatedrepo/co-night1-handoff` exists and is private.
- Branch `grace/...` exists with a README commit authored by
  `co-os-bot <co-os-bot@charlieoscar.com>`.
- PR is open with `head=grace/...`, `base=main`.
- Tool surface honoured: NO `github_merge_pr` calls (you merge via
  GitHub UI), no force pushes, no commits to main.

**Cleanup:** Delete the repo via GitHub UI when you're satisfied. The
substrate cannot delete it — `github_delete_repo` is forbidden by
design.

---

## Aftermath

Once all three scenarios pass, save the smoke result as a Cornerstone
fact (run from your shell, not from the workforce):

```
mcp call add_fact \
  key=co_workforce_co_os_smoke_complete \
  value="2026-04-27 — All three Night-1 scenarios passed in CO_OS workforce UI. Donald audit + Margaret research + Grace repo creation working end-to-end via Ada delegation. Substrate import path, persistence, SSE event stream, and Grace GitHub tools all verified under live session." \
  category=workforce
```

Then mark Night 1 complete by saving:

```
mcp call add_fact \
  key=co_workforce_night1_complete \
  value="2026-04-27 — Night 1 of 2 closed. Substrate now lives in CO_OS (deviation from brief which assumed paperclip-eval source — substrate was built directly in CO_OS, see workforce-night1 branch). HTTP API + Supabase persistence + minimal functional UI + Grace GitHub tools all shipped. Ready for Night 2 (pixel office UI on top of /api/workforce/*)." \
  category=workforce
```

Then merge `workforce-night1` into `master` once you're happy with the
review.

---

## Failure-mode triage cheatsheet

| Symptom | Likely cause | First check |
|---|---|---|
| All API calls 500 | Substrate didn't load | `tail /tmp/co-os-dev.log` for "Module not found" |
| Auth 401 everywhere | Shell env shadowing `.env.local` | `printenv \| grep CORNERSTONE` vs file |
| Tasks complete but nothing in DB | `SUPABASE_SERVICE_ROLE_KEY` empty | `awk -F= '/SUPABASE_SERVICE_ROLE_KEY/{print length($2)}' .env.local` |
| Stream stuck "connecting" | bus.ts not subscribing | Check `/api/workforce/tasks/[id]/events` route in network tab |
| Grace 403 from GitHub | Wrong PAT scope | `gh api orgs/Forgeautomatedrepo --hostname github.com --jq .login` against the PAT |
| Grace `branch_protected` error | She tried to write to main | This is correct — she should branch first |
