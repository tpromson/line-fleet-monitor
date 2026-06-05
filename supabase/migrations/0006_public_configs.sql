-- ============================================================
-- Public Page Configuration
-- ============================================================

create table public_configs (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null unique references sources(id) on delete cascade,
  enabled boolean not null default false,
  display_name text,
  show_temperature boolean not null default true,
  show_humidity boolean not null default true,
  show_min_max boolean not null default true,
  show_avg boolean not null default true,
  display_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Index for fast lookup
create index idx_public_configs_source on public_configs (source_id);
create index idx_public_configs_enabled on public_configs (enabled) where enabled = true;

-- ============================================================
-- RLS
-- ============================================================

alter table public_configs enable row level security;

-- Anyone can view enabled configs (for public page)
create policy "Anyone can view enabled public configs"
  on public_configs
  for select
  to authenticated, anon
  using (enabled = true);

-- Only super admins can manage public configs
create policy "Super admin can manage public configs"
  on public_configs
  for all
  to authenticated
  using (is_super_admin())
  with check (is_super_admin());