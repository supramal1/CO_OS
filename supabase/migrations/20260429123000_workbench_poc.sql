create table if not exists user_workbench_config (
  user_id text primary key,
  notion_parent_page_id text not null,
  drive_folder_id text not null,
  drive_folder_url text not null,
  google_oauth_grant_status text not null default 'pending',
  google_oauth_scopes text[] not null default '{}'::text[],
  voice_register text,
  feedback_style text,
  friction_tasks text[],
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists workbench_invocation_logs (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  invocation_type text not null,
  task_type text not null,
  skill_name text not null,
  skill_version text,
  estimated_before_minutes integer not null,
  observed_after_minutes integer,
  latency_ms integer,
  ask_chars integer not null,
  status text not null check (status in ('succeeded', 'failed')),
  error text,
  created_at timestamptz not null default now()
);

create index if not exists workbench_invocation_logs_user_created_idx
  on workbench_invocation_logs (user_id, created_at desc);
