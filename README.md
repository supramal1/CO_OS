# Charlie Oscar OS (co-os)

Charlie Oscar OS is the active Next.js shell for the agency operating system. It brings Speak to Charlie, Forge intake and build boards, Cookbook skills, Admin, Workforce, and Cornerstone-backed memory into one Google SSO app. This repo is the canonical frontend now, and older standalone frontend repos should not be treated as current product truth.

## Current Surface

- Speak to Charlie lives at `/speak-to-charlie`. It is the conversational Forge intake surface, backed by `/api/forge/intake/chat`, and it helps turn a loose operational problem into a structured Forge brief.
- Forge lives at `/forge` with review surfaces at `/forge/kanban`, `/forge/research-review`, and `/forge/production-review`. These pages work with Forge briefs, task gates, and production review state.
- Cookbook lives at `/cookbook`. It reads and edits skills through the Cookbook MCP proxy routes, and the admin export flow can open PRs through the configured GitHub repo.
- Agents lives at `/agents`. This is the four-column Forge build board used to move work through Backlog, In progress, Review, and Done.
- Workforce lives at `/workforce`. This is the AI Ops pixel office for dispatching Ada-led tasks, watching agents work, approving gated stewardship actions, and seeing spend as work runs.
- Admin lives at `/admin`. It owns workspace, team, audit, setup, principal detail, connection-key, invitation, and grant management through the Cornerstone admin proxy.

Admin-only modules are hidden from non-admin sessions in the top navigation. Auth is Google OAuth through NextAuth, and the server resolves each signed-in email to a Cornerstone principal and a `csk_` API key before proxying downstream calls.

## Local Setup

Install dependencies:

```bash
npm install
```

Copy the environment template and fill in secrets:

```bash
cp .env.local.example .env.local
```

Run the app:

```bash
npm run dev
```

Open `http://localhost:3000` and sign in with a `@charlieoscar.com` Google account, or with an address listed in `CO_OS_ALLOWED_EMAILS`. The default authenticated landing page is `/speak-to-charlie`.

Useful checks:

```bash
npx tsc --noEmit
npm test
npm run build
```

## Environment

Keep Vercel and `.env.local` aligned with the variables below. Some features degrade without their optional keys, but the app should make that failure obvious rather than silently pretending the surface works.

| Variable | Used by | Purpose |
| --- | --- | --- |
| `NEXTAUTH_URL` | Auth | `http://localhost:3000` in dev and the deployed URL in production. |
| `NEXTAUTH_SECRET` | Auth | NextAuth signing secret. Generate a 32+ byte value. |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Auth | Google OAuth credentials. Dev redirect URI is `http://localhost:3000/api/auth/callback/google`. |
| `CO_OS_ALLOWED_EMAILS` | Auth | Optional comma-separated allowlist beyond the `@charlieoscar.com` domain. |
| `CORNERSTONE_API_URL` | Cornerstone, Admin, Forge, Workforce | Cornerstone API base URL. Defaults are in code and `.env.local.example`, but production should set this explicitly. |
| `MEMORY_API_KEY` | Login, server-side memory tools | Cornerstone superuser key used for email-to-principal resolution and package-level fallback. Keep it server-side only. |
| `COOKBOOK_MCP_URL` | Cookbook, Workforce prompts | Cookbook MCP Cloud Run URL. |
| `GITHUB_TOKEN` | Cookbook export, Forge PR detail fallback | Fine-grained PAT for Cookbook PR export. Forge PR enrichment also checks this before `GITHUB_PERSONAL_ACCESS_TOKEN`. |
| `GITHUB_PERSONAL_ACCESS_TOKEN` | Forge PR detail fallback | Optional fallback token for Forge PR enrichment. |
| `COOKBOOK_GIT_REPO` | Cookbook export | Target repo for skill export PRs, for example `supramal1/co-cookbook`. |
| `COOKBOOK_GIT_BRANCH` | Cookbook export | Base branch for Cookbook export PRs. Defaults to `main`. |
| `COOKBOOK_GIT_AUTHOR_NAME` / `COOKBOOK_GIT_AUTHOR_EMAIL` | Cookbook export | Optional commit author metadata for export PRs. |
| `CORNERSTONE_AGENTS_URL` | Forge transitions | Cornerstone Agents service used by `/api/forge/tasks/[id]/transition` for `/invoke` and `/resume`. |
| `CORNERSTONE_AGENTS_API_KEY` | Forge transitions | Optional API key forwarded as `X-API-Key` if the agents service requires it. |
| `NEXT_PUBLIC_SUPABASE_URL` | Forge, Agents, Workforce | Supabase project URL used by browser Realtime, Forge run detail reads, and Workforce persistence setup. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Forge, Agents | Supabase anon key for browser Realtime and read surfaces. |
| `SUPABASE_SERVICE_ROLE_KEY` | Workforce | Server-side key for persisting Workforce tasks, events, results, child tasks, and approval rows. Without it, Workforce falls back toward process-local state. |
| `ANTHROPIC_API_KEY` | Speak to Charlie, Workforce | Required for Forge intake chat and Workforce dispatch. |
| `ANTHROPIC_MODEL` | Speak to Charlie | Optional model override for Forge intake chat. Defaults to `claude-sonnet-4-6`. |
| `GRACE_GITHUB_PAT` | Workforce, Grace | PAT for Grace's GitHub tools. Missing keys surface as tool errors instead of granting partial hidden access. |
| `GRACE_GITHUB_ORG` | Workforce, Grace | GitHub org for Grace. Defaults inside the substrate to `Forgeautomatedrepo`. |
| `GRACE_BRANCH_PREFIX` | Workforce, Grace | Optional branch namespace prefix for Grace. Defaults inside the substrate to `grace/`. |

## Module Map

Page routes:

| Route | Role |
| --- | --- |
| `/` | Splash page, then redirects authenticated sessions to `/speak-to-charlie`. |
| `/speak-to-charlie` | Conversational Forge intake. |
| `/forge` | Forge brief shell. |
| `/forge/kanban` | Six-lane Forge kanban reference surface. |
| `/forge/research-review` | Research review queue. |
| `/forge/production-review` | Production review queue. |
| `/cookbook` | Cookbook skill library and editor. |
| `/agents` | Admin-only four-column Forge build board. |
| `/workforce` | Admin-only AI Ops pixel office. |
| `/workforce/tasks/[id]` | Workforce task detail and event stream view. |
| `/admin` | Redirects to `/admin/workspaces`. |
| `/admin/workspaces` | Workspace list, create, archive, restore, bulk archive, and permanent delete. |
| `/admin/workspaces/[slug]` | Workspace detail, existing-principal grants, member revocation, service connection keys, and workspace lifecycle actions. |
| `/admin/team` | Team list, invitation modal, active/service/invitation tabs, bulk archive, and bulk revoke. |
| `/admin/team/[userId]` | Principal detail, credential reveal/regeneration, workspace grants, status changes, and deletion impact. |
| `/admin/audit-log` | Admin audit log. |
| `/admin/setup` | Operator setup guide for workspace and client provisioning. |

API routes:

| Route family | Role |
| --- | --- |
| `/api/auth/[...nextauth]` | Google OAuth session and Cornerstone principal resolution. |
| `/api/admin/[...path]` | Browser-to-Cornerstone admin proxy with per-principal API key auth. |
| `/api/cornerstone/query` | Streaming Cornerstone answer proxy. |
| `/api/cookbook/*` | Cookbook MCP skill read/write/export and Git PR export proxy. |
| `/api/forge/briefs/*` | Forge brief list, detail, stats, and creation. |
| `/api/forge/intake/chat` | Speak to Charlie intake chat with brief search and submit tools. |
| `/api/forge/tasks` and `/api/forge/tasks/[id]` | Forge task list, create, read, update, and delete proxy. |
| `/api/forge/tasks/[id]/transition` | Admin-only lane transition proxy to Cornerstone Agents `/invoke` or `/resume`. |
| `/api/forge/tasks/[id]/cancel` | Admin-only cancellation for running Forge tasks. |
| `/api/forge/tasks/[id]/pr` and `/api/forge/task-runs/[id]/scope` | Forge task detail enrichment for PR, run, scope, and output panels. |
| `/api/workforce/agents` | Public roster metadata for the Workforce UI. |
| `/api/workforce/tasks` | Admin-only Workforce dispatch and recent task list. |
| `/api/workforce/tasks/[id]` | Workforce task detail, including persisted child task and result data. |
| `/api/workforce/tasks/[id]/events` | SSE stream for live Workforce task events. |
| `/api/workforce/tasks/[id]/cancel` | Workforce cancellation plus pending approval cancellation. |
| `/api/workforce/approvals` and `/api/workforce/approvals/[id]` | Path Y approval inbox and approve/reject resolution. |
| `/api/workforce/health` | Workforce health check. |

## Admin

The admin module is now part of `co-os/main`, not a separate product surface. `/admin/workspaces` manages workspace records and lifecycle state. `/admin/workspaces/[slug]` handles service-principal client connections and existing-principal grants into the workspace. `/admin/team` handles people, service principals, invitations, and bulk operations. `/admin/team/[userId]` is the principal detail page for keys, grants, status, and deletion impact. `/admin/audit-log` surfaces the audit trail, and `/admin/setup` documents the operator workflow for provisioning a workspace and connecting a Claude client.

The admin frontend talks to Cornerstone through `/api/admin/[...path]`. Browser code never calls the backend admin endpoints directly, and admin gating is enforced both in the UI and in the proxy.

## Forge And Agents

`/agents` is the active four-column Forge build board. It is not the old legacy board. The columns are Backlog, In progress, Review, and Done, while the canonical task state is still the six-lane `forge_tasks.lane` lifecycle: `backlog`, `research`, `research_review`, `production`, `production_review`, and `done`.

The board groups by `task.lane`, not the legacy `task.status` field. Human drags map visual columns onto canonical lane transitions:

| Drag | Canonical transition | Backend action |
| --- | --- | --- |
| Backlog to In progress | `backlog` to `research` | Calls Cornerstone Agents `/invoke`. |
| Review to In progress from research review | `research_review` to `production` | Calls Cornerstone Agents `/resume` for the scope gate. |
| Review to Done from production review | `production_review` to `done` | Calls Cornerstone Agents `/resume` for the build gate. |

Other transitions are blocked in the client with specific explanatory toast text because some movement is automatic. For example, work in `research` and `production` moves to Review when the agent run completes.

The board has Supabase Realtime for `forge_tasks`, a polling fallback, optimistic lane updates with rollback, cost confirmation for spendful transitions, cost summaries from recorded Forge runs, task detail enrichment, PR context, scope rows, run timelines, outputs, and cancellation for running tasks. The cancellation path is `/api/forge/tasks/[id]/cancel`, and it marks cancellable running tasks as `cancelled` in the Done lane through the Cornerstone task proxy.

## Workforce

`/workforce` is the AI Ops runtime surface. Dispatch is still lead-rooted in v0, so Ada is the entry point and specialists are reached through `delegate_task`. The roster has five agents:

| Agent | Current role |
| --- | --- |
| Ada | Lead coordinator. Can delegate, can write Cornerstone facts, and closes out conversations. |
| Alan | Analysis specialist. Read-oriented, with save-conversation capability. |
| Grace | Implementation and GitHub specialist. Uses the `github_*` tool family when configured. |
| Margaret | Research specialist. Output-heavy for long structured research work. |
| Donald | Cornerstone steward. Owns steward inspect, advise, preview, apply, and status tools. |

The HTTP layer is in `app/api/workforce/*`, and the runtime bridge is in `lib/workforce/runner.ts`. The embedded `@workforce/substrate` package supplies the roster, Anthropic runtime, Cookbook system prompts, Cornerstone tools, GitHub tools, in-process delegation, recursive cost rollups, and shared cancellation signal for delegated work.

Policy alignment is enforced in the substrate and route layer: v0 dispatch is lead-only through Ada, specialists receive only the tool families their role needs, Donald alone gets the steward family, destructive stewardship is gated by the approval hook, and Grace's GitHub access flows through runtime configuration rather than ambient tool reads.

Workforce persists task rows, task events, child tasks, results, and tool approval rows through Supabase when `SUPABASE_SERVICE_ROLE_KEY` is present. The UI polls summaries, opens detail panes, streams live events over SSE, and can cancel running work through `/api/workforce/tasks/[id]/cancel`.

## Path Y Approvals

Path Y is the human-in-the-loop substrate for destructive stewardship. Donald can mount `steward_apply`, but the tool pauses on an approval request and waits for the operator to approve or reject it in the Workforce inbox. The queue is implemented in `lib/workforce/approvals.ts`, exposed through `/api/workforce/approvals`, and rendered by `components/workforce/approval-modal.tsx`.

Approval rows are persisted in `tool_approvals`, and cold starts rehydrate pending rows as orphaned approvals so the inbox can be cleared honestly. A rehydrated orphan does not resume the lost in-memory invocation, which is an intentional v0 limitation and should stay visible in operator language. Cancelling a Workforce task also cancels matching pending approvals.

Cost visibility is not a Path Y approval gate today. Spend is estimated before dispatch and shown while work runs, but cost cap overruns are warn-and-display only. Any future cost-overrun approval should be treated as a distinct approval class rather than being hidden inside `steward_apply`.

## Cost Visibility

The dispatch form estimates rough spend before submit through `lib/workforce/cost-estimator.ts`. It uses agent baselines, model multipliers, prompt length, and delegation expansion to produce intentionally coarse ranges such as `Estimated: ~$1-$5` or `Estimated: ~$5-$20`. This is transparency, not accounting.

The optional `maxCostUsd` field is stored on the task and shown in task detail and summary cards. `lib/workforce/cost-observability.ts` classifies spend as `none`, `near_cap`, `over_cap`, or `overrun` using 80 percent, 100 percent, and 120 percent ratios. `components/workforce/cost-observability.tsx` renders the dashboard band and task meters. The runtime records per-turn model cost, rolls descendant cost into `totalCostUsd`, and stores recursive result summaries so Ada-led work includes delegated spend.

## Cornerstone And Honcho Integration

Cornerstone remains the memory and admin backend. Auth resolves email to principal, downstream requests use the session-scoped `csk_` key, and workspace isolation is carried by namespace. `MEMORY_API_KEY` is only for server-side resolution and fallback paths, not for browser use.

The Workforce substrate mounts Cornerstone read and write tools per agent. `add_fact` posts to `/memory/fact`, and when recent conversation context is available the substrate includes `conversation_context` and `honcho_session_id` so Cornerstone can mirror useful context into Honcho. `save_conversation` remains available to agents that are allowed to write durable memory.

## Development Notes

This app is a Next.js 14 app with App Router. Route pages live under `app/(os)`, server routes live under `app/api`, shared browser/server helpers live under `lib`, UI components live under `components`, and the embedded Workforce package lives under `packages/workforce-substrate`.

`packages/workforce-substrate/README.md` and the older Night 1 and Night 2 docs are historical in places. Treat this README and the current code paths above as the operational map until the nested package docs get their own cleanup pass.

## Deploy

Vercel is configured from `vercel.json` and the root `package.json`. Production deploys should use `main` and set the environment variables in Vercel project settings to match this README. Do not assume production has a commit until the deployment pipeline shows a run for that exact SHA.
