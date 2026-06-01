-- ============================================================
-- Tables
-- ============================================================

create table organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

create table organization_members (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  organization_id uuid not null references organizations(id) on delete cascade,
  role text not null default 'viewer' check (role in ('admin', 'viewer')),
  created_at timestamptz not null default now(),
  unique(user_id, organization_id)
);

create table providers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now()
);

create table channels (
  id uuid primary key default gen_random_uuid(),
  provider_id uuid not null references providers(id) on delete cascade,
  channel_name text not null,
  channel_id text not null,
  channel_secret text not null,
  access_token text not null,
  quota_limit integer not null default 500,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table quota_logs (
  id uuid primary key default gen_random_uuid(),
  channel_id uuid not null references channels(id) on delete cascade,
  quota_limit integer,
  quota_used integer,
  quota_remaining integer,
  error text,
  checked_at timestamptz not null default now()
);

create index idx_quota_logs_channel_checked on quota_logs (channel_id, checked_at desc);

create table alerts (
  id uuid primary key default gen_random_uuid(),
  channel_id uuid not null references channels(id) on delete cascade,
  level text not null check (level in ('warning', 'critical', 'recovery')),
  message text not null,
  created_at timestamptz not null default now()
);

create index idx_alerts_channel_created on alerts (channel_id, created_at desc);

-- ============================================================
-- Helper functions (security definer to avoid RLS recursion)
-- ============================================================

create or replace function is_super_admin()
returns boolean
language sql
security definer
set search_path = 'public'
as $$
  select coalesce(
    (auth.jwt() -> 'app_metadata' ->> 'role') = 'super_admin',
    false
  );
$$;

create or replace function is_org_member(org_id uuid)
returns boolean
language sql
security definer
set search_path = 'public'
as $$
  select exists (
    select 1 from organization_members
    where user_id = auth.uid() and organization_id = org_id
  );
$$;

create or replace function is_org_admin(org_id uuid)
returns boolean
language sql
security definer
set search_path = 'public'
as $$
  select exists (
    select 1 from organization_members
    where user_id = auth.uid()
      and organization_id = org_id
      and role = 'admin'
  );
$$;

-- ============================================================
-- RLS: Enable on all tables
-- ============================================================

alter table organizations enable row level security;
alter table organization_members enable row level security;
alter table providers enable row level security;
alter table channels enable row level security;
alter table quota_logs enable row level security;
alter table alerts enable row level security;

-- ============================================================
-- RLS Policies: organizations
-- ============================================================

create policy "Super admin can manage all organizations"
  on organizations
  for all
  to authenticated
  using (is_super_admin())
  with check (is_super_admin());

create policy "Members can view their organizations"
  on organizations
  for select
  to authenticated
  using (is_org_member(id));

-- ============================================================
-- RLS Policies: organization_members
-- ============================================================

create policy "Super admin can manage all members"
  on organization_members
  for all
  to authenticated
  using (is_super_admin())
  with check (is_super_admin());

create policy "Org admin can manage members in their org"
  on organization_members
  for all
  to authenticated
  using (is_org_admin(organization_id));

create policy "Users can see their own membership"
  on organization_members
  for select
  to authenticated
  using (user_id = auth.uid());

-- ============================================================
-- RLS Policies: providers
-- ============================================================

create policy "Super admin can manage all providers"
  on providers
  for all
  to authenticated
  using (is_super_admin())
  with check (is_super_admin());

create policy "Org members can view providers in their org"
  on providers
  for select
  to authenticated
  using (is_org_member(organization_id));

create policy "Org admin can insert providers in their org"
  on providers
  for insert
  to authenticated
  with check (is_org_admin(organization_id));

create policy "Org admin can update providers in their org"
  on providers
  for update
  to authenticated
  using (is_org_admin(organization_id));

create policy "Org admin can delete providers in their org"
  on providers
  for delete
  to authenticated
  using (is_org_admin(organization_id));

-- ============================================================
-- RLS Policies: channels
-- ============================================================

create policy "Super admin can manage all channels"
  on channels
  for all
  to authenticated
  using (is_super_admin())
  with check (is_super_admin());

create policy "Org members can view channels in their org"
  on channels
  for select
  to authenticated
  using (
    exists (
      select 1 from providers p
      where p.id = channels.provider_id
        and is_org_member(p.organization_id)
    )
  );

create policy "Org admin can insert channels in their org"
  on channels
  for insert
  to authenticated
  with check (
    exists (
      select 1 from providers p
      where p.id = channels.provider_id
        and is_org_admin(p.organization_id)
    )
  );

create policy "Org admin can update channels in their org"
  on channels
  for update
  to authenticated
  using (
    exists (
      select 1 from providers p
      where p.id = channels.provider_id
        and is_org_admin(p.organization_id)
    )
  );

create policy "Org admin can delete channels in their org"
  on channels
  for delete
  to authenticated
  using (
    exists (
      select 1 from providers p
      where p.id = channels.provider_id
        and is_org_admin(p.organization_id)
    )
  );

-- ============================================================
-- RLS Policies: quota_logs
-- ============================================================

create policy "Super admin can manage all quota_logs"
  on quota_logs
  for all
  to authenticated
  using (is_super_admin())
  with check (is_super_admin());

create policy "Org members can view quota_logs in their org"
  on quota_logs
  for select
  to authenticated
  using (
    exists (
      select 1 from channels c
      join providers p on p.id = c.provider_id
      where c.id = quota_logs.channel_id
        and is_org_member(p.organization_id)
    )
  );

-- ============================================================
-- RLS Policies: alerts
-- ============================================================

create policy "Super admin can manage all alerts"
  on alerts
  for all
  to authenticated
  using (is_super_admin())
  with check (is_super_admin());

create policy "Org members can view alerts in their org"
  on alerts
  for select
  to authenticated
  using (
    exists (
      select 1 from channels c
      join providers p on p.id = c.provider_id
      where c.id = alerts.channel_id
        and is_org_member(p.organization_id)
    )
  );

-- ============================================================
-- Column-Level Privileges: protect channel secrets
-- ============================================================

revoke select (channel_secret, access_token) on channels from authenticated, anon;

grant select (channel_secret, access_token) on channels to service_role;
