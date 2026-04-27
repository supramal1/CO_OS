# Charlie Oscar OS (co-os)

The Charlie Oscar operating system — a Next.js app that unifies Cornerstone (memory/chat), Cookbook (skills), Cowork (clients), and Forge (agents) behind a single shell and a single Google SSO.

## Local setup

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment

Copy the template and fill in secrets:

```bash
cp .env.local.example .env.local
```

Required variables:

| Variable | Purpose |
| --- | --- |
| `NEXTAUTH_URL` | `http://localhost:3000` for dev; the deployed URL in prod |
| `NEXTAUTH_SECRET` | Random 32+ byte string (`openssl rand -base64 32`) |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Google OAuth creds. Authorised redirect: `http://localhost:3000/api/auth/callback/google` |
| `CORNERSTONE_API_URL` | Cornerstone Cloud Run URL (default in example file) |
| `MEMORY_API_KEY` | Cornerstone superuser key — used only server-side for email → principal resolution on login |
| `COOKBOOK_MCP_URL` | Cookbook MCP Cloud Run URL (default in example file) |
| `CO_OS_ALLOWED_EMAILS` | Optional comma-separated allowlist beyond the `@charlieoscar.com` domain |

### 3. Run the dev server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

### 4. Sign in

Use a `@charlieoscar.com` Google account (or an address listed in `CO_OS_ALLOWED_EMAILS`). On first login the server resolves your email to a Cornerstone principal and issues a `csk_` API key stored in the JWT. All downstream calls — Cornerstone `/answer` streaming and Cookbook MCP tool invocations — are proxied server-side using that user-scoped key.

## Architecture

- `app/(os)/` — authenticated route group sharing the top-bar shell
- `app/api/cookbook/*` — thin proxy routes wrapping the Cookbook MCP (`lib/cookbook-client.ts`)
- `app/api/cornerstone/query` — streaming proxy to Cornerstone `/answer` (NDJSON passthrough)
- `app/api/workforce/*` — HTTP API around `@workforce/substrate` (dispatch, list, detail, cancel, SSE event stream, health)
- `components/cookbook/*` — Cookbook UI; fetches from `/api/cookbook/skills`
- `components/cornerstone/*` — Chat UI; posts to `/api/cornerstone/query`, parses NDJSON via `lib/cornerstone-stream.ts`
- `components/workforce/*` — minimal functional dispatch UI (pixel office lands Night 2 on top of this)
- `lib/auth.ts` — NextAuth Google OAuth + principal resolution
- `lib/cornerstone.ts` — server helpers (`resolveEmailToPrincipal`, `checkAdminCapability`, `listWorkspaces`)
- `lib/workforce/*` — runner bridge between HTTP API and the substrate (in-memory registry + Supabase persistence + SSE pub/sub)
- `packages/workforce-substrate/` — the v0 AI Ops workforce (Ada/Alan/Grace/Margaret/Donald) on Anthropic Messages API + Cornerstone + delegate_task. Imported via tsconfig path alias; Next bundles it via `transpilePackages`.

## Workforce module

Admin-only at `/workforce`. Lead-rooted dispatch (always Ada in v0); Ada delegates to specialists in-process. Live event log via SSE, cost/duration/output persisted to Supabase. See `packages/workforce-substrate/docs/co-os-smoke-runbook.md` for the dogfood smoke walkthrough.

Required additional env beyond the table above: `ANTHROPIC_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `GRACE_GITHUB_PAT`, `GRACE_GITHUB_ORG` (defaults `Forgeautomatedrepo`).

## Deploy

Vercel auto-deploys from `main`. Project config: `vercel.json` / root `package.json`. Env vars must be set in Vercel project settings to match `.env.local.example`.
