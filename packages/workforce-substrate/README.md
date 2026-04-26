# @co/workforce-substrate

CO AI Ops Workforce substrate **v0**. Replaces the Paperclip harness for the
five-agent AI Ops roster with a thin custom orchestration layer on top of the
Anthropic Messages API (`@anthropic-ai/sdk`). The substrate runs the agent
loop itself — model turn → tool dispatch → tool_result → next model turn —
which keeps observability and cancellation under our control. The
`@anthropic-ai/claude-agent-sdk` package is intentionally NOT used here: it
targets Claude Code-style file/bash agents, not the Cornerstone-tool-driven
workforce we need.

## What v0 is

- **Single-process synchronous invocation.** No background scheduler, no
  reconciler, no continuous heartbeat. Every task wakes a fresh agent run and
  returns the result.
- **CLI only.** `npm run invoke -- <agentName> "<task>"` from this package.
- **In-memory state.** No persistent task storage in v0. Persistence arrives
  with the Cloud Run deploy sprint.
- **No HTTP API.** Same as above. Cloud Run sprint adds the HTTP surface.
- **No UI.** Per `co_workforce_ui_v1_brief`, the UI sprint starts only after
  this backend is locked.
- **Anthropic-only.** Single-purpose substrate — no adapter abstractions for
  other providers. YAGNI per the locked architecture.

## delegate_task in v0

Per `co_ai_ops_delegation_architecture_locked` the parent calls `delegate_task`,
the substrate routes to the assignee agent, the child runs synchronously from
the parent's perspective, and the child's output returns to the parent as a
`tool_result`. The parent then synthesises.

In v0 this is **in-process recursion**, not HTTP. The recursive call shares an
event log with the parent so the full tree is observable in one trace. The
HTTP surface arrives when this lands on Cloud Run.

Locked guards:

- `canDelegate=true` only on Ada — enforced at the tool-build site, the tool
  is not even mounted on specialist agents.
- Self-delegation rejected at the dispatch site.
- `reportsTo` validated server-side: the assignee must report to the parent.
- Cycle detection via `Task.ancestry` — re-entering an in-flight task id is
  rejected.
- Depth limit of `MAX_DELEGATION_DEPTH` (3).

## Cornerstone in v0

11 agent-facing tools port from the Paperclip managed-agents adapter:
`get_context`, `search`, `list_facts`, `recall`, `add_fact`,
`save_conversation`, `steward_inspect`, `steward_advise`, `steward_preview`,
`steward_apply`, `steward_status`.

Locked behaviours:

- `targetWorkspace` from the Task wins over agent input on writes (delegation
  safety / prompt-injection guard).
- Reads accept agent-supplied namespace as an escape hatch when the task has
  no `targetWorkspace` pinned.
- Writes always force the resolved write-namespace (task → `aiops` fallback).
- `steward_apply` returns `pending_approval` with structured error code —
  blocked entirely until the approval-queue UI lands.

## Roster

| Agent | Slug | Lead | Cornerstone read | Cornerstone write | Other tools |
|-------|------|------|------------------|-------------------|-------------|
| Ada | `ada` | yes | yes | yes (save_conversation) | `delegate_task`, `web_search` |
| Alan | `alan` | no | yes | yes (`add_fact`, `save_conversation`) | `web_search` |
| Grace | `grace` | no | yes | yes (`add_fact`, `save_conversation`) | (real coding tools land later) |
| Margaret | `margaret` | no | no | no | `web_search` |
| Donald | `donald` | no | yes | yes (`add_fact`, `save_conversation`, steward_*) | — |

System prompts load from Cookbook by skill name (`ada-system-prompt`, etc.)
at roster build time. Prompts are NOT duplicated in code.

## Out of scope for v0

- HTTP API
- Web UI integration
- Persistent task storage
- Approval queue UI for `steward_apply`
- OAuth flows
- Real coding tools for Grace
- Production deploy

If smoke tests force any of these, that's a scope-creep signal — STOP and
re-scope rather than expand.

## Tests

```bash
cd packages/workforce-substrate
npm install
npm run test
```

Runtime, Cornerstone integration, and delegation tests use a mocked Anthropic
SDK and a mocked `fetch` — they never hit live services. The CLI smoke
scenarios in `bin/smoke/` hit real services.

## CLI

```bash
# Donald solo
npx tsx bin/invoke.ts donald "audit the aiops workspace for duplicate facts" \
  --target-workspace=aiops

# Ada delegates to Margaret
npx tsx bin/invoke.ts ada \
  "research current state of OpenAI Realtime API and produce a one-page brief"

# Ada delegates to Donald, fails gracefully
npx tsx bin/invoke.ts ada \
  "audit a workspace I don't have access to" \
  --target-workspace=client-paid-media
```

Options: `--target-workspace=<ws>`, `--max-cost=<dollars>`, `--output=json|text`,
`--debug` (verbose event log to stderr).

## Smoke suite

Two drivers live in `bin/smoke/`:

- **`run-all.sh`** — production-shaped run via the CLI. Loads each agent's
  system prompt from Cookbook by `systemPromptSkill`. This is the runtime
  contract — prompts are NOT duplicated in code.
- **`run-direct.ts`** — direct `invokeAgent` driver that overrides
  `systemPromptLoader` with tiny inline scenario prompts. Exists ONLY to give
  us live-network verification of the runtime, Cornerstone tool dispatch, and
  the `delegate_task` recursion loop while a Cookbook scope grant is being
  sorted out. NOT used by anything in production. Delete once the production
  roster can load prompts cleanly.

### Cookbook scope-grant gap (deployment blocker)

The v0 agent prompts are scoped to `team:ai-ops` on Cookbook. The substrate's
caller principal must hold a grant for that scope or `get_skill` returns
`skill_out_of_scope`. The CLI / `run-all.sh` path will fail until either
(a) the running principal is granted `team:ai-ops`, or (b) the prompts are
moved to `global` scope, or (c) we deploy with a service-account principal
that already has the grant. `run-direct.ts` is the bypass we have until then.

## Required env

| Variable | Purpose |
|----------|---------|
| `ANTHROPIC_API_KEY` | Anthropic Messages API calls |
| `CORNERSTONE_API_KEY` | Cornerstone REST + Cookbook MCP auth (csk_*). Preferred. |
| `MEMORY_API_KEY` | Legacy fallback for Cornerstone REST. Cookbook MCP rejects non-csk_ keys, so `CORNERSTONE_API_KEY` is required for prompt fetch. |
| `COOKBOOK_API_KEY` | Optional explicit override — wins over the two above for Cookbook calls only. |
| `CORNERSTONE_API_URL` | Optional; defaults to prod Cloud Run. |
| `COOKBOOK_MCP_URL` | Optional; defaults to prod Cloud Run. |

Cookbook key resolution: `COOKBOOK_API_KEY` → `CORNERSTONE_API_KEY` →
`MEMORY_API_KEY` (first non-empty wins).
