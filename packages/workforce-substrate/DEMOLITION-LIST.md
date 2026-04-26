# Phase 1 Demolition — Findings

Date: 2026-04-26
Branch: `workforce-substrate-v0`
Scope: `~/co-os` (the CO_OS Next.js app)

## Result: nothing to demolish

`grep -ril -E "(paperclip|managed-agents|managed_agents|paperclip-workforce|paperclip-spike|heartbeat_runs|reconciler)"` against the entire co-os tree (excluding `node_modules` and `.next`) returns **zero matches** across:

- `app/**` (route handlers, pages, layouts)
- `components/**` (Cookbook, Cornerstone, Forge UI components)
- `lib/**` (auth, cookbook-client, cornerstone-stream, forge-types)
- `types/**`
- `__tests__/**`
- `package.json`, `tsconfig.json`, `next.config.mjs`, `README.md`

## Why this is the result

co-os was built as the unified shell for Cornerstone / Cookbook / Cowork / Forge — it was never coupled to the Paperclip workforce harness. Paperclip lives entirely in `~/paperclip-eval/paperclip-src` as a fork of the upstream managed-agents repo, and the workforce backend ran out-of-process on Cloud Run (`paperclip-workforce-*`).

The pivot per `co_workforce_harness_pivot_decision` only requires CO_OS to grow a new `packages/workforce-substrate` — it does not require any removals from the existing app surface. The previous AI Ops workforce traffic flowed agent → Cloud Run → Cornerstone API directly, and CO_OS never proxied or mounted that path.

## Action

No deletions. No commits to remove anything. Phase 1 is documentation-only: this file records that the demolition surface is empty, so reviewers don't waste a cycle hunting for residue.

## Out-of-tree (kept as deprecated reference)

- `~/paperclip-eval/paperclip-src` — Paperclip fork. Stays as deprecated reference for porting tool specs and dispatch logic.
- `~/.paperclip` and `~/.paperclip-worktrees` — local config and worktrees for the Paperclip CLI. Untouched.

If any future CO_OS PR introduces a `@paperclipai/*` import or an HTTP call to a `paperclip-workforce-*.run.app` URL, that's the signal to re-open this file and add real entries.

## Checkpoint fact

Saved as `co_workforce_v0_demolition_complete` (2026-04-26).
