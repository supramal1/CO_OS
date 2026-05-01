create table if not exists public.deck_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) > 0),
  brand text,
  client text,
  use_case text not null default 'general',
  status text not null default 'draft' check (status in ('draft', 'active', 'archived')),
  source_pptx_path text,
  google_slides_template_id text,
  google_slides_template_url text,
  is_default boolean not null default false,
  layout_manifest jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists deck_templates_one_active_default
  on public.deck_templates (is_default)
  where is_default = true and status = 'active';

create index if not exists deck_templates_status_idx
  on public.deck_templates (status, created_at desc);

alter table public.deck_templates enable row level security;
