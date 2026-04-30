# Workbench Workflow Hardening Sprint Design

## Goal

Workbench V1 should become a guided staff workflow rather than a collection of setup panels and raw preflight output. The next sprint hardens the production path around `Understand -> Gather -> Make -> Review -> Save`, fixes the onboarding profile-preview failure, and keeps personalisation quiet, reversible, and useful.

## Product Premise

Workbench is the primary staff-facing surface of Charlie Oscar OS. It should help staff move from a vague task to a usable work artefact by compressing production-heavy work while preserving judgement points.

The product should feel like a senior operator sitting beside a junior team member:

- clarifying the ask,
- finding relevant context,
- making a strong first version,
- challenging weak thinking,
- saving the work properly,
- remembering useful preferences over time.

The goal is not only faster output. The goal is faster output with better judgement.

## Workflow Model

The explicit V1 workflow is:

1. `Understand`: decode what is being asked, who it is for, what good looks like, missing context, and decisions that need human judgement.
2. `Gather`: retrieve relevant context from Cornerstone, Notion, Calendar, Drive, Cookbook, previous examples, and current project/client context.
3. `Make`: generate structured starting material for the requested artefact.
4. `Review`: act as a senior quality gate before the user sends or saves anything.
5. `Save`: push the artefact and useful metadata back into the real work environment.

`Learn` is not a visible main stage. It appears only as lightweight inline controls when Workbench is about to remember something or when a reversible profile update has been made.

## Stage Responsibilities

### Understand

The current preflight task decoding becomes the `Understand` stage. It must identify:

- task type,
- audience,
- likely goal,
- requested output,
- judgement needed,
- missing context,
- what should not be assumed.

This stage should give junior staff a clear shape of the task before any drafting.

### Gather

The current retrieval path becomes the `Gather` stage. It must expose simple provenance:

- source name,
- source status,
- how many useful items were used,
- whether each item is evidence or inference.

Cornerstone and Cookbook power this stage, but they must not become extra destinations during normal staff work.

### Make

The `Make` stage creates a usable first version, not a final authority. Supported V1 artefacts are:

- client email draft,
- brief outline,
- report section,
- research summary,
- action plan,
- meeting prep,
- options and recommendation,
- Notion/Google Docs-ready artefact.

The rule is: scaffold, do not overclaim.

### Review

Review is the key V1 quality gate. Before save/send, Workbench should check:

- whether the answer addresses the ask,
- visible assumptions,
- evidence gaps,
- tone,
- recommendation clarity,
- whether a director would challenge any claim,
- whether the output is too generic,
- whether a relevant Cookbook rubric applies,
- what the user should verify manually.

Review output should be practical and concise. It should produce sections such as `Senior challenge`, `Evidence gaps`, `Tone check`, `Cookbook check`, and `Manual verification`.

### Save

Save writes or exports into existing staff destinations:

- Notion,
- Google Docs,
- Google Drive,
- clipboard,
- run history.

Save should preserve metadata: task, sources, output, accepted edits, review result, and destination.

## Personalisation And Learning

Notion is the visible second brain. The app database is the system ledger.

Workbench should continue to use the canonical `CO Workbench` parent, but the long-term page model should move toward:

- `Personal Profile`,
- `Working On`,
- `Voice & Style`,
- `Reusable Context`,
- `Feedback & Coaching`,
- `Do Not Assume`.

The current implementation has `Voice`, `Patterns`, and `References`. This sprint may add aliases or migration-safe compatibility, but it must not break existing users.

Learning should capture:

- preferred output length,
- tone preferences,
- common clients/projects,
- current workstreams,
- repeated task types,
- accepted or rejected structures,
- useful source pages,
- manager feedback patterns,
- things not to assume.

Learning UI should appear as inline cards:

- high confidence: `Profile updated: client email style` with `View` and `Undo`,
- lower confidence: `Workbench noticed...` with `Remember`, `Not now`, and `Edit`.

There must be no separate `Learn` tab for junior users.

## Reliability Requirements

The production profile-preview failure reported on 2026-04-30 is a P0 item for this sprint. The current user-facing error was:

```text
Workbench could not generate a profile preview right now. Please try again.
```

The sprint should make this failure diagnosable and non-blocking:

- add server-side reason codes for onboarding draft failures,
- distinguish model unavailable, model request failed, invalid model JSON, missing environment, and invalid payload,
- add a deterministic fallback preview so onboarding can continue without a model,
- keep sensitive provider details out of staff UI,
- log enough operator detail to debug production.

The pending `workbench_profile_updates` Supabase migration is also P0 because it blocks reliable profile-update provenance. The migration must be applied and verified in the target Supabase project before claiming profile learning is production-ready.

## UI Shape

Workbench should move toward a three-column work surface:

- left: task input and workflow stages,
- center: current stage output,
- right: context, sources, checks, and profile notices,
- bottom or local footer: primary action for the current stage.

Primary stage actions:

- Understand: `Confirm task`,
- Gather: `Use this context`,
- Make: `Generate draft`,
- Review: `Apply fixes` or `Approve`,
- Save: `Save to Notion`, `Create Doc`, or `Copy`.

The UI must stay simple for junior staff. No raw Cornerstone admin surface, no separate Cookbook destination, and no complex visible agent orchestration in this sprint.

## Data And Provenance

For each profile update, the app database should store:

- user ID,
- run ID,
- target page/section,
- candidate text,
- previous value where available,
- new value,
- source signal,
- confidence,
- status,
- Notion page/block affected,
- accepted/edited/rejected/undone state,
- timestamps.

Run history should connect the task, sources, generated artefact, review output, save target, and profile updates.

## Non-Goals

This sprint does not include:

- full Forge specialist-agent orchestration,
- manager/team coaching dashboards,
- destructive cleanup of duplicate Notion pages,
- a separate Learn tab,
- exposing raw Cornerstone or Cookbook admin workflows to junior staff.

## Acceptance Criteria

- A production staff user can fill out onboarding and receive a preview even if the model call fails.
- The onboarding API returns actionable operator reason codes without exposing sensitive details to staff.
- The `workbench_profile_updates` table exists in production Supabase and profile updates can be recorded.
- A Workbench task can visibly progress through `Understand`, `Gather`, `Make`, `Review`, and `Save`.
- Review identifies at least assumptions, evidence gaps, tone issues, Cookbook/rubric checks, and manual verification points.
- Save can preserve artefact metadata and destination status in run history.
- Profile learning appears only as small inline controls and supports undo or rejection.
- Reconnecting Notion does not create a new `CO Workbench` when an accessible one exists.
- Full TypeScript, Vitest, lint, build, and production smoke verification pass.
