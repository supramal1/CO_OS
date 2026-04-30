# Workbench Personalisation Sprint Design

## Goal

Workbench V1 should behave like a staff-ready assistant: it should reuse an existing Notion workspace, onboard staff in under five minutes, populate the personalisation pages, and improve those pages from usage without asking staff to maintain them.

## Decisions

- Staff should never choose between duplicate Notion workspaces.
- If a `CO Workbench` parent exists, Workbench connects to an existing one.
- If none exists, Workbench creates one.
- Reconnect must not create another parent just because the stored config was disconnected or stale.
- Onboarding should be short and sharp: sparse staff inputs plus AI expansion.
- Ask-based learning should be automatic by default, visible, reversible, and conservative.

## Notion Canonical Setup

Notion setup resolves a canonical parent in this order:

1. Use the stored `notion_parent_page_id` if accessible.
2. Otherwise search accessible Notion pages titled `CO Workbench`.
3. If one or more exists, pick automatically:
   - highest count of required children wins,
   - archived/inaccessible candidates lose,
   - ties resolve by stable oldest/first returned order.
4. Repair missing required children.
5. Create a new parent only when no accessible parent exists.
6. Persist the canonical parent ID back to `user_workbench_config`.

V1 does not delete old duplicate pages. Once canonical config is repaired, duplicates are ignored until a deliberate cleanup tool exists.

## Onboarding

Onboarding captures only the minimum useful signal:

- role/team/tenure,
- current work bullets,
- friction-task chips plus optional other,
- feedback style,
- output/voice preference,
- optional personal context bullets.

The UI must fit a five-minute budget. Staff can enter bullets; AI expands them into concise Notion-ready sections. The user sees a preview before the initial write because onboarding is an explicit setup moment.

Accepted onboarding writes to:

- `Personal Profile`: stable role, context, preferences.
- `Working On`: current work and active focus.
- `Voice`: output and feedback preferences.

`Patterns` is primarily usage-learned. `References` remains for later explicit references or save-back.

## Auto-Learning

Each successful ask can produce learning candidates. Workbench classifies each candidate as:

- `write`: durable, low-risk, useful for future work,
- `needs_more_evidence`: plausible but should wait for repeated evidence,
- `skip`: one-off, sensitive, speculative, or low value.

V1 writes only compact, low-risk updates:

- current work signals to `Working On`,
- repeated style/output preferences to `Voice`,
- repeated useful task patterns to `Patterns`,
- stable context from onboarding to `Personal Profile`.

Do not auto-write sensitive personal details, negative judgments, speculative claims, or one-off task facts. Failed/not-useful runs can update correction preferences only when the signal is explicit.

Every write stores provenance in Supabase: user, target page, source run if any, text, status, and timestamp. The UI shows recent profile updates and supports undoing the latest update by marking it undone and appending a compact correction note where possible.

## Friendly Staff States

Workbench setup language should be staff-facing:

- Connected
- Needs reconnect
- Setting up workspace
- Repairing pages
- Profile updated
- Undo last profile update

Avoid exposing Notion IDs, token status, or low-level failure codes unless the UI is showing an operator/debug detail.

## Verification

Release is blocked unless these are true:

- reconnecting Notion three times does not create a fourth active `CO Workbench`,
- duplicate active children are not created under the canonical parent,
- onboarding writes concise content into the expected pages,
- a successful ask can create a conservative learning update,
- disabling/undoing learning prevents future use of that update,
- full TypeScript, Vitest, lint, and build pass.
