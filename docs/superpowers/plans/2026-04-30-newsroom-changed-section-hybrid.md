# Newsroom Changed Section Hybrid Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the implementation-log style `Changed Since Yesterday` summary with a hybrid operating brief: narrative orientation plus compact follow-up judgement rows.

**Architecture:** Keep the existing Newsroom adapter/ranking/UI boundaries. Cornerstone facts are still loaded in `lib/newsroom/adapters.ts`, but their values are grouped into product-level themes before becoming one Newsroom item. The UI renders newline-delimited reason text as structured narrative and `Worth looking at` rows without changing the public API shape.

**Tech Stack:** Next.js App Router, TypeScript, React client component, Vitest, existing Newsroom modules.

---

### Task 1: Product-Level Cornerstone Summary

**Files:**
- Modify: `__tests__/newsroom-adapters.test.ts`
- Modify: `lib/newsroom/adapters.ts`

- [ ] **Step 1: Write the failing test**

Update the existing Cornerstone facts test so it expects:

```ts
{
  id: "cornerstone-facts-summary",
  title: "Workbench and Newsroom moved closer to daily staff use",
  reason:
    "Workbench gained a clearer context-needed resume flow and staged make/review handling. Newsroom now uses Cornerstone facts to explain what changed without exposing raw implementation logs.\n\nWorth looking at\n- Connector setup: Calendar and Notion still need setup resolution before Newsroom can fully orient the day.\n- Brief quality: Keep translating implementation facts into product meaning, not branch names or paths.",
  source: "cornerstone",
  confidence: "high",
  section: "changedSinceYesterday",
  signals: ["changed_since_yesterday", "human_decision"],
  sourceRefs: [
    "cornerstone:fact:co_workbench_context_resume_rerun_local",
    "cornerstone:fact:co_newsroom_changed_section_quality",
    "cornerstone:fact:co_workbench_personalisation_sprint_decision",
  ],
}
```

- [ ] **Step 2: Verify the test fails**

Run:

```bash
npm test -- __tests__/newsroom-adapters.test.ts
```

Expected: the updated test fails because the adapter still emits a weaker generic summary.

- [ ] **Step 3: Implement product grouping**

In `lib/newsroom/adapters.ts`, update `summarizeCornerstoneFactCandidates` so it:

- derives themes from fact values, not keys
- strips local paths, branch names, and commit hashes
- creates one title from detected themes
- emits a narrative paragraph plus `Worth looking at` rows
- includes `human_decision` when follow-up rows exist

- [ ] **Step 4: Verify the adapter test passes**

Run:

```bash
npm test -- __tests__/newsroom-adapters.test.ts
```

Expected: all adapter tests pass.

### Task 2: Render Hybrid Reason Text

**Files:**
- Modify: `components/newsroom/newsroom-shell.tsx`
- Add/modify: `__tests__/newsroom-display.test.ts`

- [ ] **Step 1: Write the failing display helper test**

Add a pure helper test that formats a reason containing:

```text
Narrative sentence.

Worth looking at
- Connector setup: Calendar and Notion need setup resolution.
- Brief quality: Keep product meaning.
```

Expected parsed output:

```ts
{
  narrative: "Narrative sentence.",
  followUps: [
    { title: "Connector setup", detail: "Calendar and Notion need setup resolution." },
    { title: "Brief quality", detail: "Keep product meaning." },
  ],
}
```

- [ ] **Step 2: Verify the helper test fails**

Run:

```bash
npm test -- __tests__/newsroom-display.test.ts
```

Expected: failure because no parser exists yet.

- [ ] **Step 3: Implement and render helper**

Add `formatNewsroomReason` to `components/newsroom/newsroom-display.ts`. Use it in `NewsroomItemRow` so normal items render as they do today, while hybrid reason text renders as a narrative paragraph plus compact follow-up rows.

- [ ] **Step 4: Verify display tests pass**

Run:

```bash
npm test -- __tests__/newsroom-display.test.ts
```

Expected: all display helper tests pass.

### Task 3: Regression Verification

**Files:**
- Existing changed files only.

- [ ] **Step 1: Run Newsroom regression tests**

```bash
npm test -- __tests__/newsroom-ranking.test.ts __tests__/newsroom-brief.test.ts __tests__/newsroom-adapters.test.ts __tests__/newsroom-route.test.ts __tests__/newsroom-display.test.ts __tests__/modules.test.ts
```

Expected: all tests pass.

- [ ] **Step 2: Run TypeScript and ESLint**

```bash
npx tsc --noEmit --pretty false
./node_modules/.bin/eslint lib/newsroom/adapters.ts lib/newsroom/ranking.ts components/newsroom/newsroom-display.ts __tests__/newsroom-adapters.test.ts __tests__/newsroom-display.test.ts __tests__/newsroom-ranking.test.ts
```

Expected: both commands exit 0.

- [ ] **Step 3: Smoke the route**

```bash
curl -I http://localhost:3002/newsroom
```

Expected: `HTTP/1.1 200 OK`.

- [ ] **Step 4: Commit**

```bash
git add lib/newsroom/adapters.ts components/newsroom/newsroom-display.ts __tests__/newsroom-adapters.test.ts __tests__/newsroom-display.test.ts docs/superpowers/plans/2026-04-30-newsroom-changed-section-hybrid.md
git commit -m "Improve Newsroom changed brief quality"
```
