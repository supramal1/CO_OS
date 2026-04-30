# Workbench Workflow Hardening Supabase Runbook

Date: 2026-04-30

## Scope

Apply and verify the Workbench profile update ledger schema used by the human-in-the-loop learning layer.

The ledger is the app-side audit trail for profile learning. Notion remains the user-visible second brain.

## Migration

Apply pending Supabase migrations after authenticating the project:

```bash
supabase migration up
```

If using the Supabase MCP, apply:

- `supabase/migrations/20260430110000_workbench_profile_updates.sql`
- `supabase/migrations/20260430132000_workbench_profile_update_provenance.sql`

## Verification SQL

```sql
select to_regclass('public.workbench_profile_updates');
```

```sql
select column_name
from information_schema.columns
where table_schema = 'public'
  and table_name = 'workbench_profile_updates'
  and column_name in (
    'source_signal',
    'confidence',
    'previous_value',
    'new_value',
    'user_decision'
  )
order by column_name;
```

Expected columns:

- `confidence`
- `new_value`
- `previous_value`
- `source_signal`
- `user_decision`

## Smoke

1. Complete Workbench onboarding and accept a profile update.
2. Send a Workbench ask that includes a safe durable preference.
3. Confirm one `workbench_profile_updates` row is created with `source_signal`, `confidence`, `new_value`, and the Workbench run id.
4. Use the profile notice undo control.
5. Confirm the same row has `status = 'undone'`, `user_decision = 'undone'`, `undo_reason`, and `undone_at`.

## Security Check

Run the Supabase security advisor after applying the migration. Confirm row level security remains enabled on `workbench_profile_updates`.
