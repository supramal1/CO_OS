# Workbench V1 Smoke Checklist

Use this for local and prod verification before calling the V1 staff path ready.

## Setup

- Confirm the active user is a staff principal and `/workbench` loads.
- Set up Notion through the Workbench connector flow. It should create or validate one `CO Workbench` parent with these children: Personal Profile, Working On, Patterns, References, Voice.
- Set up Google through the Workbench connector flow. Required scopes are Drive file, Sheets, and Calendar readonly. Gmail scopes are not allowed.
- Run connector repair from the Workbench setup UI or route when any connector reports `repair_available`, `resource_missing`, `token_missing`, or `scope_missing`.

## Acceptance Smoke

- Run an ask from `/workbench` and confirm pre-flight completes.
- Confirm source statuses are visible for config, Notion, Google, Calendar, and Drive. Degraded sources should show a clear status and reason.
- Confirm save-back creates a readable Drive artifact when Drive is ready.
- Confirm prior runs can be listed and opened through Workbench via `/api/workbench/runs`. If storage is unavailable, apply the `workbench_run_history` migration before staff smoke.
- Confirm a rejected Anthropic key returns `anthropic_api_key_rejected` with the local-key restart instruction.

## Duplicate Checks

- Notion: search for `CO Workbench` and confirm the configured parent is the only active Workbench parent for the user. Confirm exactly one active child per required page title.
- Drive: search for `CO Workbench` and confirm the configured folder is the only active Workbench Drive folder for the user.
- Supabase: confirm `user_workbench_config`, `workbench_notion_tokens`, and `workbench_google_tokens` have no duplicate active rows for the staff principal.

## Credential And Env Hygiene

- Rotate any exposed Notion credentials immediately, including `NOTION_API_TOKEN`, OAuth client secret, and any integration token pasted into logs or chat.
- Check the Anthropic env override issue before testing: a shell-exported `ANTHROPIC_API_KEY` can override `.env.local`. Clear the shell export or restart with `env -u ANTHROPIC_API_KEY npm run dev`.
- Recheck runtime text for Gmail, POC, proof-of-concept, or demo wording before release.
