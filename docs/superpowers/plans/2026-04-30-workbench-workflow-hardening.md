# Workbench Workflow Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Harden Workbench V1 into a guided `Understand -> Gather -> Make -> Review -> Save` staff workflow, with reliable onboarding preview and quiet reversible personalisation.

**Architecture:** Keep existing Workbench APIs as narrow route wrappers around `lib/workbench/*` service modules. Add explicit workflow-stage types and derivation helpers, introduce Make and Review services beside the existing preflight/retrieval path, and keep provenance in Supabase while Notion remains the visible second brain.

**Tech Stack:** Next.js App Router, TypeScript, Vitest, Supabase service-role REST, Notion REST API, Google Drive/Calendar connectors, Anthropic SDK, Cookbook and Cornerstone retrieval.

---

## File Map

- Modify `lib/workbench/personalisation.ts`: add fallback onboarding draft and richer draft failure reasons.
- Modify `lib/workbench/onboarding-action.ts`: return staff-safe messages plus operator reason codes.
- Modify `app/api/workbench/onboarding/route.ts`: expose structured onboarding failures.
- Modify `__tests__/workbench-onboarding.test.ts`: cover production profile-preview failure modes and fallback preview.
- Modify `lib/workbench/learning.ts`: verify production persistence expectations and confidence/status fields.
- Modify `supabase/migrations/20260430110000_workbench_profile_updates.sql`: add any missing provenance columns required by the sprint.
- Create `lib/workbench/workflow.ts`: stage model, transitions, and stage summaries.
- Modify `lib/workbench/types.ts`: add workflow stage fields to `WorkbenchStartResponse` without breaking existing callers.
- Modify `lib/workbench/start.ts`: map current preflight/retrieval output into `Understand` and `Gather`.
- Create `lib/workbench/make.ts`: artefact generation boundary and typed Make output.
- Create `lib/workbench/review.ts`: senior challenge, assumptions, evidence gap, Cookbook check, tone check, manual verification output.
- Create `app/api/workbench/make/route.ts`: authenticated Make endpoint.
- Create `app/api/workbench/review/route.ts`: authenticated Review endpoint.
- Modify `lib/workbench/presend-start.ts` and `lib/workbench/presend.ts`: include reviewed artefact metadata in Save.
- Modify `components/workbench/workbench-shell.tsx`: guided stage UI, right-side sources/checks/profile notices, inline learning controls.
- Modify `lib/workbench/ui-state.ts`: staff-facing stage, review, save, and learning summaries.
- Add or modify focused tests in `__tests__/workbench-ui.test.ts`, `__tests__/workbench-start-route.test.ts`, `__tests__/workbench-presend-route.test.ts`, and new Make/Review tests.

## Task 1: Profile Preview Reliability

**Files:**
- Modify: `lib/workbench/personalisation.ts`
- Modify: `lib/workbench/onboarding-action.ts`
- Modify: `app/api/workbench/onboarding/route.ts`
- Test: `__tests__/workbench-onboarding.test.ts`

- [ ] **Step 1: Write failing tests for production preview failure reasons**

Add tests that assert:

```ts
await expectDraft({
  modelClient: null,
}).toMatchObject({
  status: "drafted",
  fallback: true,
  warning: "onboarding_model_unavailable",
});
```

Add a model failure case that expects a fallback draft and an operator reason:

```ts
const modelClient = { create: vi.fn(async () => { throw new Error("401 invalid x-api-key"); }) };
const result = await generateWorkbenchOnboardingDraft({ payload: validPayload(), modelClient });
expect(result).toMatchObject({
  status: "drafted",
  fallback: true,
  warning: "onboarding_draft_failed",
});
expect(JSON.stringify(result)).not.toContain("invalid x-api-key");
```

- [ ] **Step 2: Run the focused tests and confirm they fail**

Run:

```bash
npx vitest run __tests__/workbench-onboarding.test.ts
```

Expected: tests fail because fallback draft status and warning fields do not exist yet.

- [ ] **Step 3: Implement fallback onboarding preview**

Change `WorkbenchOnboardingDraftResult` so model failures can return a drafted fallback:

```ts
type WorkbenchOnboardingDraftResult =
  | { status: "drafted"; draft: WorkbenchOnboardingDraft; fallback?: boolean; warning?: string }
  | { status: "invalid_payload"; error: "invalid_workbench_onboarding_payload"; fields: string[]; message: string }
  | { status: "error"; error: "onboarding_draft_invalid_json"; message: string; operator_reason?: string };
```

Add a deterministic fallback builder:

```ts
function buildFallbackOnboardingDraft(payload: WorkbenchOnboardingPayload): WorkbenchOnboardingDraft {
  return {
    personal_profile: {
      bullets: [
        `${payload.role_title}.`,
        `Communication style: ${payload.communication_style.join("; ")}.`,
      ],
    },
    working_on: {
      bullets: payload.current_focus.map((item) => `${item}.`),
    },
    voice: {
      bullets: [
        `Preferred style: ${payload.communication_style.join("; ")}.`,
        `Challenge style: ${payload.challenge_style.join("; ")}.`,
      ],
    },
  };
}
```

Use the fallback when the model client is missing or throws. Keep invalid JSON as an error unless the response is empty from a provider failure.

- [ ] **Step 4: Add staff-safe API reason codes**

In `runWorkbenchOnboardingAction`, return `status: 200` for fallback drafts and include:

```ts
{
  status: "drafted",
  fallback: true,
  warning: "onboarding_draft_failed",
  message: "Profile preview generated from your setup details."
}
```

Do not expose provider messages such as API keys, tokens, request IDs, or raw stack traces.

- [ ] **Step 5: Verify and commit**

Run:

```bash
npx vitest run __tests__/workbench-onboarding.test.ts
npx tsc --noEmit
```

Commit:

```bash
git add lib/workbench/personalisation.ts lib/workbench/onboarding-action.ts app/api/workbench/onboarding/route.ts __tests__/workbench-onboarding.test.ts
git commit -m "fix: make Workbench onboarding preview resilient"
```

## Task 2: Supabase Profile Update Ledger

**Files:**
- Modify: `supabase/migrations/20260430110000_workbench_profile_updates.sql`
- Modify: `lib/workbench/learning.ts`
- Test: `__tests__/workbench-learning.test.ts`

- [ ] **Step 1: Confirm required ledger fields in tests**

Add tests that a stored profile update includes:

```ts
expect(store.insert).toHaveBeenCalledWith(expect.objectContaining({
  user_id: "principal_123",
  source_run_id: "run_123",
  target_page: "Voice",
  candidate_text: "Prefers concise client emails.",
  status: "pending",
  classification: expect.objectContaining({ confidence: expect.any(Number) }),
}));
```

- [ ] **Step 2: Update migration if needed**

Ensure the migration includes the ledger fields from the design:

```sql
source_signal text,
confidence numeric check (confidence is null or (confidence >= 0 and confidence <= 1)),
previous_value text,
new_value text,
user_decision text check (user_decision in ('accepted', 'edited', 'rejected', 'undone')),
```

If the current JSON `classification` already carries a field, keep it but add top-level columns that are needed for filtering and undo.

- [ ] **Step 3: Add production migration runbook**

Create `docs/superpowers/plans/2026-04-30-workbench-workflow-hardening-supabase-runbook.md` with:

```markdown
# Supabase Migration Runbook

1. Authenticate Supabase MCP or CLI.
2. Apply `20260430110000_workbench_profile_updates.sql`.
3. Verify `public.workbench_profile_updates` exists.
4. Run advisor security checks.
5. Run a Workbench task and confirm a profile update row is written or skipped with provenance.
```

- [ ] **Step 4: Verify and commit**

Run:

```bash
npx vitest run __tests__/workbench-learning.test.ts
npx tsc --noEmit
```

Commit:

```bash
git add supabase/migrations/20260430110000_workbench_profile_updates.sql lib/workbench/learning.ts __tests__/workbench-learning.test.ts docs/superpowers/plans/2026-04-30-workbench-workflow-hardening-supabase-runbook.md
git commit -m "feat: harden Workbench profile update ledger"
```

## Task 3: Explicit Workflow Stage Model

**Files:**
- Create: `lib/workbench/workflow.ts`
- Modify: `lib/workbench/types.ts`
- Modify: `lib/workbench/start.ts`
- Test: `__tests__/workbench-start-route.test.ts`

- [ ] **Step 1: Write failing tests for stage output**

Assert `/api/workbench/start` includes:

```ts
expect(body.workflow).toMatchObject({
  current_stage: "understand",
  stages: [
    { id: "understand", status: "complete" },
    { id: "gather", status: "complete" },
    { id: "make", status: "available" },
    { id: "review", status: "locked" },
    { id: "save", status: "locked" },
  ],
});
```

- [ ] **Step 2: Add workflow types**

Create:

```ts
export type WorkbenchWorkflowStageId = "understand" | "gather" | "make" | "review" | "save";
export type WorkbenchWorkflowStageStatus = "locked" | "available" | "active" | "complete" | "error";
export type WorkbenchWorkflowStage = {
  id: WorkbenchWorkflowStageId;
  label: string;
  status: WorkbenchWorkflowStageStatus;
  summary: string;
};
export type WorkbenchWorkflowState = {
  current_stage: WorkbenchWorkflowStageId;
  stages: WorkbenchWorkflowStage[];
};
```

- [ ] **Step 3: Derive workflow from start response**

In `start.ts`, add a workflow summary after preflight and retrieval. Do not change existing `result`, `retrieval`, or `invocation` shapes.

- [ ] **Step 4: Verify and commit**

Run:

```bash
npx vitest run __tests__/workbench-start-route.test.ts __tests__/workbench-ui.test.ts
npx tsc --noEmit
```

Commit:

```bash
git add lib/workbench/workflow.ts lib/workbench/types.ts lib/workbench/start.ts __tests__/workbench-start-route.test.ts __tests__/workbench-ui.test.ts
git commit -m "feat: add Workbench workflow stage model"
```

## Task 4: Make Artefact Generation

**Files:**
- Create: `lib/workbench/make.ts`
- Create: `app/api/workbench/make/route.ts`
- Test: `__tests__/workbench-make.test.ts`
- Test: `__tests__/workbench-make-route.test.ts`

- [ ] **Step 1: Write failing service tests**

Cover these outputs:

```ts
expect(result).toMatchObject({
  status: "drafted",
  artifact: {
    type: "client_email",
    title: expect.any(String),
    body: expect.stringContaining(""),
    assumptions: expect.any(Array),
    source_refs: expect.any(Array),
  },
});
```

Also test missing model client returns:

```ts
{ status: "unavailable", reason: "workbench_make_model_unavailable" }
```

- [ ] **Step 2: Implement Make service boundary**

Add:

```ts
export type WorkbenchArtifactType =
  | "client_email"
  | "brief_outline"
  | "report_section"
  | "research_summary"
  | "action_plan"
  | "meeting_prep"
  | "options_recommendation"
  | "notion_doc";
```

Use the existing Anthropic boundary style from onboarding/preflight. Return strict JSON only.

- [ ] **Step 3: Add authenticated route**

The route accepts:

```ts
{
  ask: string;
  preflight_result: WorkbenchPreflightResult;
  retrieved_context: WorkbenchRetrievedContext[];
}
```

Return the drafted artefact or a staff-safe unavailable/error result.

- [ ] **Step 4: Verify and commit**

Run:

```bash
npx vitest run __tests__/workbench-make.test.ts __tests__/workbench-make-route.test.ts
npx tsc --noEmit
```

Commit:

```bash
git add lib/workbench/make.ts app/api/workbench/make/route.ts __tests__/workbench-make.test.ts __tests__/workbench-make-route.test.ts
git commit -m "feat: add Workbench make stage"
```

## Task 5: Review Quality Gate

**Files:**
- Create: `lib/workbench/review.ts`
- Create: `app/api/workbench/review/route.ts`
- Test: `__tests__/workbench-review.test.ts`
- Test: `__tests__/workbench-review-route.test.ts`

- [ ] **Step 1: Write failing review tests**

Assert review returns:

```ts
expect(result.review).toMatchObject({
  senior_challenge: expect.any(Array),
  assumptions: expect.any(Array),
  evidence_gaps: expect.any(Array),
  cookbook_check: expect.any(Array),
  tone_check: expect.any(Array),
  manual_verification: expect.any(Array),
  overall_status: expect.stringMatching(/needs_revision|approved_with_checks|approved/),
});
```

- [ ] **Step 2: Implement deterministic fallback checks**

Before using a model, implement simple checks:

- if artifact has no source refs but makes factual claims, add an evidence gap,
- if artifact body is under 80 characters, add a senior challenge,
- if audience is client and tone is apologetic-heavy, add tone check,
- if Cookbook retrieval is unavailable, add manual verification.

- [ ] **Step 3: Add model-assisted review**

Use model output to enrich the fallback checks, but never remove deterministic warnings unless the model explicitly resolves them with source evidence.

- [ ] **Step 4: Verify and commit**

Run:

```bash
npx vitest run __tests__/workbench-review.test.ts __tests__/workbench-review-route.test.ts
npx tsc --noEmit
```

Commit:

```bash
git add lib/workbench/review.ts app/api/workbench/review/route.ts __tests__/workbench-review.test.ts __tests__/workbench-review-route.test.ts
git commit -m "feat: add Workbench review gate"
```

## Task 6: Guided Workbench UI

**Files:**
- Modify: `components/workbench/workbench-shell.tsx`
- Modify: `lib/workbench/ui-state.ts`
- Test: `__tests__/workbench-ui.test.ts`

- [ ] **Step 1: Write failing UI derivation tests**

Assert UI helpers derive:

```ts
expect(deriveWorkbenchStageRows(workflow)).toEqual([
  expect.objectContaining({ label: "Understand", state: "complete" }),
  expect.objectContaining({ label: "Gather", state: "complete" }),
  expect.objectContaining({ label: "Make", state: "available" }),
  expect.objectContaining({ label: "Review", state: "locked" }),
  expect.objectContaining({ label: "Save", state: "locked" }),
]);
```

Assert source code contains stage labels and does not contain a top-level `Learn` tab.

- [ ] **Step 2: Reshape shell around stages**

Keep existing setup and run history available, but make the main task surface:

- left: task and stage list,
- center: stage output,
- right: sources, checks, profile notices.

Do not introduce decorative dashboard cards or marketing copy.

- [ ] **Step 3: Wire Make and Review actions**

Add local state for Make and Review route responses. Primary actions should progress the user through stages without losing the original preflight result.

- [ ] **Step 4: Verify and commit**

Run:

```bash
npx vitest run __tests__/workbench-ui.test.ts
npx tsc --noEmit
```

Commit:

```bash
git add components/workbench/workbench-shell.tsx lib/workbench/ui-state.ts __tests__/workbench-ui.test.ts
git commit -m "feat: guide Workbench through workflow stages"
```

## Task 7: Save And Learning Controls

**Files:**
- Modify: `lib/workbench/presend.ts`
- Modify: `lib/workbench/presend-start.ts`
- Modify: `lib/workbench/output-actions.ts`
- Modify: `components/workbench/workbench-shell.tsx`
- Test: `__tests__/workbench-presend-route.test.ts`
- Test: `__tests__/workbench-output-actions-route.test.ts`
- Test: `__tests__/workbench-ui.test.ts`

- [ ] **Step 1: Write failing tests for reviewed artefact metadata**

Assert save-back payload stores:

```ts
expect(saveBack.artifact).toMatchObject({
  review_status: "approved_with_checks",
  source_count: expect.any(Number),
  destination: expect.any(String),
});
```

- [ ] **Step 2: Add inline learning controls**

Use existing profile update state and add low-confidence controls:

- `View`,
- `Undo`,
- `Remember`,
- `Not now`,
- `Edit`.

Actions can be route-backed stubs if the persistence route is not complete, but the UI state and action payloads must be typed.

- [ ] **Step 3: Verify and commit**

Run:

```bash
npx vitest run __tests__/workbench-presend-route.test.ts __tests__/workbench-output-actions-route.test.ts __tests__/workbench-ui.test.ts
npx tsc --noEmit
```

Commit:

```bash
git add lib/workbench/presend.ts lib/workbench/presend-start.ts lib/workbench/output-actions.ts components/workbench/workbench-shell.tsx __tests__/workbench-presend-route.test.ts __tests__/workbench-output-actions-route.test.ts __tests__/workbench-ui.test.ts
git commit -m "feat: connect save stage and learning controls"
```

## Task 8: Production Smoke And Release

**Files:**
- Modify: `docs/superpowers/plans/2026-04-30-workbench-workflow-hardening.md`

- [ ] **Step 1: Run full local verification**

Run:

```bash
npx tsc --noEmit
npm test
npm run lint
npm run build
```

Expected:

- TypeScript exits 0,
- Vitest reports all files/tests passing,
- lint exits 0 with only known warnings unless the sprint removes them,
- build exits 0 and lists `/workbench`, `/api/workbench/make`, `/api/workbench/review`, and existing Workbench routes.

- [ ] **Step 2: Apply and verify Supabase migration**

Use Supabase MCP or approved CLI path. Verify:

```sql
select to_regclass('public.workbench_profile_updates');
```

Expected: `workbench_profile_updates`.

- [ ] **Step 3: Deploy preview or production**

If shipping directly:

```bash
git checkout main
git merge --ff-only <sprint-branch>
git push origin main
vercel deploy --prod --yes
```

- [ ] **Step 4: Production smoke**

Verify:

- `curl -I https://co-os.vercel.app/workbench` returns `200`,
- onboarding profile preview returns a preview,
- Notion reconnect reuses an existing accessible `CO Workbench`,
- task can reach Understand, Gather, Make, Review, Save,
- Review surfaces at least one meaningful quality gate item for an intentionally thin draft,
- Save records destination status,
- profile learning notice supports undo or not-now.

- [ ] **Step 5: Save Cornerstone release facts**

Record:

- deployment ID,
- Git commit,
- migration status,
- smoke result,
- any residual risks.
