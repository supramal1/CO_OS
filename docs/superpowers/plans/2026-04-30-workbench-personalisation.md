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

- [x] Write failing tests proving reconnect with stale/null config reuses existing `CO Workbench` instead of creating a duplicate.
- [x] Extend Notion setup client boundary with a title search method.
- [x] Implement canonical parent scoring by required child count.
- [x] Repair missing children and persist canonical parent ID.
- [x] Verify targeted Notion setup tests pass.

## Task 2: Notion Page Writing Boundary

- [x] Write failing tests for appending concise sections to `Personal Profile`, `Working On`, and `Voice`.
- [x] Add Notion block append support to the client boundary.
- [x] Add safe page content writer helpers that only append compact Workbench-managed sections.
- [x] Verify targeted Notion client and personalisation tests pass.

## Task 3: Five-Minute Onboarding Model and API

- [x] Write failing tests for onboarding input validation and AI draft parsing.
- [x] Implement short onboarding payload schema.
- [x] Implement AI draft generation with a strict JSON response shape.
- [x] Implement save action that stores config and writes approved content to Notion pages.
- [x] Verify route tests pass without live Anthropic/Notion calls.

## Task 4: Auto-Learning Pipeline

- [x] Write failing tests for learning candidate classification: write, needs_more_evidence, skip.
- [x] Add `workbench_profile_updates` migration and persistence helper.
- [x] Hook successful runs into non-blocking learning after run history persistence.
- [x] Write only conservative updates to Notion pages and record provenance.
- [x] Verify start-flow tests still pass when learning succeeds, skips, or fails.

## Task 5: Workbench UI and Staff-Friendly States

- [x] Write failing UI derivation tests for onboarding states and profile update status.
- [x] Add compact onboarding UI to the setup panel.
- [x] Replace technical connector copy where staff-facing.
- [x] Add recent profile update and undo affordance.
- [x] Verify `workbench-ui.test.ts` and focused route tests pass.

## Task 6: Integrated Verification

- [x] Run `npx tsc --noEmit`.
- [x] Run targeted Workbench tests.
- [x] Run `npm test`.
- [x] Run `npm run lint`.
- [x] Run `npm run build`.
- [x] Run a duplicate scan against local mocks and document residual production cleanup needs.
