create table if not exists workbench_google_tokens (
  user_id text primary key,
  access_token_ciphertext text not null,
  refresh_token_ciphertext text,
  expires_at timestamptz,
  scope text[] not null default '{}'::text[],
  token_type text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
