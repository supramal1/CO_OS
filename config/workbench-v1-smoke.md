# Workbench V1 Release Gate

Use this for local and prod verification before calling the V1 staff path ready.

## 0. Release Blockers

Do not call Workbench V1 staff-ready while any item below is true:

- Required env vars are missing in the target environment: `ANTHROPIC_API_KEY`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `NEXTAUTH_URL` or `AUTH_URL`, `NEXTAUTH_SECRET`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `NOTION_OAUTH_CLIENT_ID`, `NOTION_OAUTH_CLIENT_SECRET`, and `NOTION_OAUTH_REDIRECT_URI`.
- OAuth redirect URLs are not registered exactly for the target origin. Google must return to the NextAuth Google callback for that origin, and Notion must match `NOTION_OAUTH_REDIRECT_URI` for `/api/workbench/notion/callback`.
- Supabase migrations are unapplied: `20260429123000_workbench_poc`, `20260429150000_workbench_google_tokens`, `20260429170000_workbench_notion_tokens`, `20260429171000_workbench_partial_connector_config`, `20260429213000_workbench_run_history`, and `20260429214500_workbench_output_feedback`.
- Gmail appears anywhere in the V1 runtime as a connector, scope, output action, button, or staff-facing promise. Gmail is a forbidden V1 release blocker term except for this explicit blocker check.
- POC, proof-of-concept, demo, demonstration, sample workflow, or toy wording appears in staff-facing Workbench text.
- Any exposed secret or exposed credential is found in git, logs, screenshots, chat, Vercel env history, Supabase SQL output, or browser devtools. Rotate immediately before continuing.
- Runtime testing is affected by a shell-exported `ANTHROPIC_API_KEY` that overrides `.env.local`. Clear the shell export or restart with `env -u ANTHROPIC_API_KEY npm run dev`.

## 1. Connector Setup Gate

- Confirm the active user is a staff principal and `/workbench` loads.
- Set up Notion through the Workbench connector flow. It should create or validate exactly one active `CO Workbench` parent with these children: Personal Profile, Working On, Patterns, References, Voice.
- Disconnect Notion through the Workbench connector management flow, then set up Notion again. The setup-again pass must reuse or repair the intended `CO Workbench` workspace and must not create duplicate active parents or duplicate active children.
- Set up Google Drive through the Workbench connector flow. Required Google scopes are Drive file, Sheets, and Calendar readonly: `https://www.googleapis.com/auth/drive.file`, `https://www.googleapis.com/auth/spreadsheets`, and `https://www.googleapis.com/auth/calendar.readonly`.
- Disconnect Google Drive through the Workbench connector management flow, then set up Google Drive again. The setup-again pass must reuse or repair the intended `CO Workbench` Drive folder and must not create a duplicate active Drive folder.
- Run connector repair from the Workbench setup UI or route when any connector reports `repair_available`, `resource_missing`, `token_missing`, or `scope_missing`.

## 2. Staff Acceptance Smoke

- Run an ask from `/workbench` and confirm pre-flight completes.
- Confirm retrieval statuses are visible for config, Notion, Google, Calendar, and Drive. Degraded sources should show a clear status and reason, and a missing source must not be silently presented as successful retrieval.
- Confirm Drive save-back creates a readable Drive artifact when Drive is ready. Open the artifact from the returned link and verify the staff principal can read it.
- Confirm prior runs can be listed and opened through Workbench via `/api/workbench/runs`. If storage is unavailable, apply the `20260429213000_workbench_run_history` migration before staff smoke.
- Trigger a feedback action from the Workbench output UI. Confirm `feedback_useful` or `feedback_not_useful` returns a handled result, and if storage is unavailable, apply the `20260429214500_workbench_output_feedback` migration before release.
- Confirm a rejected Anthropic key returns `anthropic_api_key_rejected` with the local-key restart instruction.

## 3. Duplicate Checks

- Notion: search for `CO Workbench` and confirm the configured parent is the only active Workbench parent for the user. Confirm exactly one active child per required page title.
- Drive: search for `CO Workbench` and confirm the configured folder is the only active Workbench Drive folder for the user.
- Supabase: confirm `user_workbench_config`, `workbench_notion_tokens`, and `workbench_google_tokens` have no duplicate active rows for the staff principal.
