create table if not exists workbench_output_feedback (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  run_id text null,
  action text not null check (
    action in ('feedback_useful', 'feedback_not_useful')
  ),
  sentiment text not null check (
    sentiment in ('useful', 'not_useful')
  ),
  payload jsonb null,
  created_at timestamptz not null default now()
);

create index if not exists workbench_output_feedback_user_created_idx
  on workbench_output_feedback (user_id, created_at desc);

create index if not exists workbench_output_feedback_run_idx
  on workbench_output_feedback (run_id)
  where run_id is not null;

alter table workbench_output_feedback enable row level security;
