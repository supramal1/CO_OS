# Workbench V1 Release Gate

Use this gate before staff rollout in each target environment. Record the target origin, commit SHA, staff principal, operator, timestamp, and evidence links for each step.

## Release Blockers

Do not call Workbench V1 staff-ready while any item below is true:

- Required env vars are missing: `ANTHROPIC_API_KEY`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `NEXTAUTH_URL` or `AUTH_URL`, `NEXTAUTH_SECRET`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `NOTION_OAUTH_CLIENT_ID`, `NOTION_OAUTH_CLIENT_SECRET`, and `NOTION_OAUTH_REDIRECT_URI`.
- OAuth redirect URLs are not registered for the exact target origin. Google must return to the NextAuth Google callback, and Notion must match `NOTION_OAUTH_REDIRECT_URI` for `/api/workbench/notion/callback`.
- Supabase migrations are unapplied: `20260429123000_workbench_poc`, `20260429150000_workbench_google_tokens`, `20260429170000_workbench_notion_tokens`, `20260429171000_workbench_partial_connector_config`, `20260429213000_workbench_run_history`, and `20260429214500_workbench_output_feedback`.
- Gmail appears anywhere in the V1 runtime as a connector, scope, output action, button, or staff-facing promise. Gmail is a forbidden V1 release blocker term except for this explicit blocker check.
- POC, proof-of-concept, demo, demonstration, sample workflow, or toy wording appears in staff-facing Workbench text.
- Any exposed secret, exposed credential, user API key, or session API key is found in git, logs, screenshots, chat, Vercel env history, Supabase SQL output, browser devtools, or staff-facing JSON. Rotate before continuing.
- Runtime testing is affected by a shell-exported `ANTHROPIC_API_KEY` that overrides `.env.local`. Clear it or restart with `env -u ANTHROPIC_API_KEY npm run dev`.

## Manual Smoke Sequence

1. Setup Notion: sign in as the staff principal, open `/workbench`, run the Notion connector flow, and confirm exactly one active `CO Workbench` parent with these children: Personal Profile, Working On, Patterns, References, Voice.
2. Disconnect Notion: use Workbench connector management to disconnect Notion, then confirm Workbench reports Notion disconnected without deleting unrelated staff content.
3. Setup Notion again: run setup a second time and confirm it can reuse or repair the intended `CO Workbench` workspace. Block release if it creates duplicate active parents or duplicate active children.
4. Setup Google Workspace/Drive: run the Google Workspace connector flow and confirm Drive file, Sheets, and Calendar readonly scopes are granted: `https://www.googleapis.com/auth/drive.file`, `https://www.googleapis.com/auth/spreadsheets`, and `https://www.googleapis.com/auth/calendar.readonly`.
5. Disconnect Google Workspace/Drive: disconnect through Workbench connector management and confirm Workbench reports Google Workspace/Drive disconnected.
6. Setup Google Workspace/Drive again: run setup a second time and confirm it can reuse or repair the intended `CO Workbench` Drive folder. Block release if it creates a duplicate active Drive folder.
7. Run ask: submit a representative staff ask from `/workbench`, confirm pre-flight completes, and confirm source status is visible for config, Notion, Google, Calendar, and Drive. Degraded retrieval must show a clear reason.
8. Save-back: from the Workbench output UI, save the result to Drive. Open the returned Drive artifact link and confirm the staff principal can read it.
9. Feedback: trigger useful and not-useful feedback actions. Confirm `feedback_useful` and `feedback_not_useful` return handled results, and apply `20260429214500_workbench_output_feedback` if storage is unavailable.
10. Recent runs: open recent runs from Workbench and confirm the ask appears, can be reopened, and has the expected retrieval/output metadata. Apply `20260429213000_workbench_run_history` if storage is unavailable.
11. Duplicate checks: search Notion and Drive for `CO Workbench`, then confirm the configured Notion parent, required Notion children, Drive folder, `user_workbench_config`, `workbench_notion_tokens`, and `workbench_google_tokens` have no duplicate active rows or resources for the staff principal.
12. Env/secret checks: verify target env values are present without printing secret values, scan staff-visible UI/API output for exposed secrets, confirm OAuth redirect origins match the target, and confirm a rejected Anthropic key returns `anthropic_api_key_rejected` with the restart instruction.

## Pass Criteria

- Every sequence step has operator evidence and no unresolved blocker.
- Connector setup is idempotent after disconnect/reconnect for both Notion and Google Workspace/Drive.
- Ask, save-back, feedback, and recent runs work for the staff principal in the target environment.
