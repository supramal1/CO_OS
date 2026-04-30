create table if not exists workbench_profile_updates (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  target_page text not null check (
    target_page in (
      'Personal Profile',
      'Working On',
      'Patterns',
      'References',
      'Voice'
    )
  ),
  source_run_id text,
  candidate_text text not null check (char_length(btrim(candidate_text)) > 0),
  status text not null check (
    status in (
      'pending',
      'written',
      'needs_more_evidence',
      'skipped',
      'undone',
      'error'
    )
  ),
  classification jsonb not null default '{}'::jsonb,
  notion_page_id text,
  notion_block_id text,
  undo_of_update_id uuid references workbench_profile_updates(id),
  undo_reason text,
  undo_metadata jsonb,
  undone_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists workbench_profile_updates_user_created_idx
  on workbench_profile_updates (user_id, created_at desc);

create index if not exists workbench_profile_updates_source_run_idx
  on workbench_profile_updates (source_run_id)
  where source_run_id is not null;

create index if not exists workbench_profile_updates_user_status_idx
  on workbench_profile_updates (user_id, status, created_at desc);

alter table workbench_profile_updates enable row level security;
