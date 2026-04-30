create table if not exists workbench_notion_tokens (
  user_id text primary key,
  access_token_ciphertext text not null,
  refresh_token_ciphertext text,
  bot_id text,
  workspace_id text,
  workspace_name text,
  duplicated_template_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table workbench_notion_tokens enable row level security;
