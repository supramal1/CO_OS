# Workbench Personalisation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop Notion duplicate creation, add fast staff onboarding that writes personalisation to Notion, and add automatic conservative learning from Workbench runs.

**Architecture:** Extend the Notion setup service so canonical workspace resolution happens before creation. Add a personalisation service with AI draft, Notion write, learning classification, and Supabase provenance. Keep UI changes in the Workbench shell and keep backend routes small.

**Tech Stack:** Next.js App Router, TypeScript, Vitest, Supabase service-role client, Notion REST API, Anthropic SDK.

---

## File Map

- Modify `lib/workbench/notion-client.ts`: add page search by title and block append/update boundary.
- Modify `lib/workbench/notion-setup.ts`: canonical parent resolver and child repair.
- Modify `__tests__/workbench-notion-setup.test.ts`: red/green duplicate regression tests.
- Create `lib/workbench/personalisation.ts`: onboarding input validation, AI draft shape, Notion page content mapping, learning classifier types.
- Create `app/api/workbench/onboarding/route.ts`: authenticated onboarding draft/save endpoint.
- Create `lib/workbench/learning.ts`: post-run candidate extraction/classification/persistence hooks.
- Modify `lib/workbench/start.ts`: call non-blocking learning after run history persistence.
- Modify `components/workbench/workbench-shell.tsx`: short onboarding UI, friendly setup states, profile update status.
- Add Supabase migration for `workbench_profile_updates`.
- Add focused Vitest coverage for each lane.

## Task 1: Notion Canonical Workspace Resolution

- [ ] Write failing tests proving reconnect with stale/null config reuses existing `CO Workbench` instead of creating a duplicate.
- [ ] Extend Notion setup client boundary with a title search method.
- [ ] Implement canonical parent scoring by required child count.
- [ ] Repair missing children and persist canonical parent ID.
- [ ] Verify targeted Notion setup tests pass.

## Task 2: Notion Page Writing Boundary

- [ ] Write failing tests for appending concise sections to `Personal Profile`, `Working On`, and `Voice`.
- [ ] Add Notion block append support to the client boundary.
- [ ] Add safe page content writer helpers that only append compact Workbench-managed sections.
- [ ] Verify targeted Notion client and personalisation tests pass.

## Task 3: Five-Minute Onboarding Model and API

- [ ] Write failing tests for onboarding input validation and AI draft parsing.
- [ ] Implement short onboarding payload schema.
- [ ] Implement AI draft generation with a strict JSON response shape.
- [ ] Implement save action that stores config and writes approved content to Notion pages.
- [ ] Verify route tests pass without live Anthropic/Notion calls.

## Task 4: Auto-Learning Pipeline

- [ ] Write failing tests for learning candidate classification: write, needs_more_evidence, skip.
- [ ] Add `workbench_profile_updates` migration and persistence helper.
- [ ] Hook successful runs into non-blocking learning after run history persistence.
- [ ] Write only conservative updates to Notion pages and record provenance.
- [ ] Verify start-flow tests still pass when learning succeeds, skips, or fails.

## Task 5: Workbench UI and Staff-Friendly States

- [ ] Write failing UI derivation tests for onboarding states and profile update status.
- [ ] Add compact onboarding UI to the setup panel.
- [ ] Replace technical connector copy where staff-facing.
- [ ] Add recent profile update and undo affordance.
- [ ] Verify `workbench-ui.test.ts` and focused route tests pass.

## Task 6: Integrated Verification

- [ ] Run `npx tsc --noEmit`.
- [ ] Run targeted Workbench tests.
- [ ] Run `npm test`.
- [ ] Run `npm run lint`.
- [ ] Run `npm run build`.
- [ ] Run a duplicate scan against local mocks and document residual production cleanup needs.
