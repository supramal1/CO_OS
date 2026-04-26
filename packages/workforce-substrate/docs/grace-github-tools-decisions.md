# Grace GitHub Tools — Phase 5 Decision Record (Night 1)

**Status:** Decisions made autonomously per Mal's "im going out please make
decision autonomously" instruction (2026-04-26 evening). Mal to review on
wakeup before any of these become irreversible.

**Branch:** `workforce-night1`

---

## Context

Brief (Night 1, Phase 5) lists four architectural questions that block
Phase 6 coding. Mal authorised autonomous decisions in advance; this doc
captures the chosen path with rationale and the dial each decision can
move on later if Mal disagrees.

---

## A — GitHub auth pattern

**Decision: PAT.** Use `GRACE_GITHUB_PAT` env var (already populated in
`.env.local` from Mal's hand-off message — issued 2026-04-27 specifically
for this sprint, scoped to `Forgeautomatedrepo` org).

**Rationale:**
- Mal explicitly handed over a PAT in the dispatch message. That signals
  PAT is the intended path for v1.
- Brief explicitly lists "GitHub App migration" as out-of-scope tonight.
- "OAuth with per-user delegation" requires user-flow plumbing CO_OS
  doesn't have in 2026-04 timeframe — way beyond Night 1 scope.

**Tradeoff to flag:** PAT inherits Mal's identity (or whoever minted it).
Audit trail attribution will read "supramal1" rather than "grace". Fine
for dogfood; needs GitHub App when we start commenting / opening PRs at
scale or for client-visible work.

**Dial for later:** Swap implementation behind `buildGitHubTools(...)` —
the substrate's tool builder pattern lets us replace the auth without
touching Grace's prompt.

---

## B — Repo creation scope

**Decisions:**
- **Org:** `Forgeautomatedrepo` (matches PAT scope; `GRACE_GITHUB_ORG` env
  var pins this).
- **Naming convention:** `{slug}` directly. Mal types repo names; Grace
  doesn't auto-prefix. Lowercase-kebab (Grace's prompt enforces).
- **Visibility default:** `private`. Grace must be told "public" explicitly
  to ship a public repo. Reduces accidental disclosure on first dogfood.
- **Init style:** Empty init by default (no template). Mal can request
  template-clone via prompt (e.g. "fork template-x as new repo y") and
  Grace's `clone_repo` covers that.

**Rationale:**
- Forgeautomatedrepo is the org PAT covers; no other choice without
  re-minting.
- Empty init is least surprise — Mal sees exactly what Grace produces, no
  hidden boilerplate.
- Private default is the safe choice when the workforce is dogfood-stage
  and prompt behaviour isn't fully proven.

**Dial for later:** Add a per-team default-template config in
`packages/workforce-substrate/src/agents/grace.ts` once Mal has a preferred
starter (Next.js + TS + the CO_OS lint config, probably).

---

## C — Branch / PR autonomy

**Decision: Option (ii) — Grace works on feature branches, opens PRs, Mal
reviews and merges.**

Specifically:
- Grace **never pushes directly to `main`** of any repo she touches.
- All work happens on a feature branch she creates (`grace/{topic}-{ts}`
  by default; she can choose semantic names from the task).
- When work is ready, Grace opens a PR back to `main`.
- The merge is **Mal's decision**, gated through GitHub's normal PR UI.
- Tools surface includes `comment_on_pr` so Grace can answer follow-ups
  if Mal asks for changes within the same task.

**Rationale:**
- Preserves Mal-as-merge-gate without building an approval queue UI
  tonight (that's a deferred Night 2+ concern per brief).
- Existing GitHub PR UI is the review surface — no new code.
- Direct-to-main (option i) is reckless for code Mal hasn't read.
- Cross-agent review (option iii) requires multi-agent coordination
  semantics we haven't built; brief explicitly defers to "post-dogfood".

**Dial for later:** Move to (iii) when we have a Forge-kanban-style
review surface where Donald or Margaret can PR-review before Mal sees it.

---

## D — Tool surface

**Decision:** Adopt the brief's IN list verbatim. Adopt the OUT list
verbatim. One addition flagged below.

**IN (will ship):**
- `create_repo` — empty init, private default
- `clone_repo` — into a working dir scoped per task
- `create_branch` — off `main` only, `grace/...` namespace by default
- `read_file` — at any commit / branch
- `write_file` — local working copy only; `commit_changes` materialises
- `delete_file` — local working copy only
- `commit_changes` — composes `git add` + `git commit` with a Grace-authored
  message (`co-os-bot <co-os-bot@charlieoscar.com>` author)
- `push` — branch must be a Grace-namespaced branch; pushing to `main`
  errors out at the tool layer
- `open_pr` — base=`main`, head=Grace's branch
- `read_pr_status` — for follow-ups
- `comment_on_pr` — for follow-ups

**OUT (explicitly forbidden, will return `permission_denied`):**
- `merge_pr` — Mal-only, via GitHub UI
- `delete_repo` — destructive, never
- `force_push` — destructive, never (regular `push` rejects `--force` arg)
- `modify_branch_protection` — Mal-only, via GitHub UI

**Addition flagged for review:** `list_branches` (read-only). Useful so
Grace can check the state of a repo before creating a new branch (avoids
collisions, lets her resume in-progress work). Low-risk — pure read.
**Defaulting to YES** unless Mal pushes back.

**Tool surface stays additive only.** No tool ever does multi-step
"create repo + commit + open PR" as one mega-tool — Grace composes them
one call at a time so the EventLog audit trail is granular and
restartable.

---

## Audit trail invariant

Every tool call emits a `tool_called` and `tool_returned` event with:
- `tool_name`
- `args` (with sensitive fields like the PAT redacted)
- `repo` (org/name)
- `result_summary` (commit sha, PR number, etc.)

This means every Grace action is reconstructible from the event log
alone — essential for Mal-review and for cost / audit attribution later.

---

## Approval pending Mal review

**Grace's Cookbook prompt update (Phase 6 final step):** Per anti-goal
"Modified agent system prompts beyond Grace's GitHub capability addition
(and that needs Mal approval)" — the prompt update will be drafted and
saved as a markdown diff in this docs folder, NOT shipped to Cookbook,
until Mal approves.

---

*Written 2026-04-26 evening. Mal: please ack or counter on wakeup.*
