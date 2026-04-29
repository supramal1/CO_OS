create table if not exists workbench_run_history (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  ask text not null check (char_length(btrim(ask)) > 0),
  result jsonb not null default '{}'::jsonb,
  retrieval jsonb not null default '{}'::jsonb,
  invocation jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists workbench_run_history_user_created_idx
  on workbench_run_history (user_id, created_at desc);

alter table workbench_run_history enable row level security;
