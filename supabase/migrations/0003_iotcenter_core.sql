-- ============================================================
-- IoTcenter Core Tables
-- ============================================================

create table source_types (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  display_name text not null,
  description text,
  created_at timestamptz not null default now()
);

create table sources (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  source_type_id uuid not null references source_types(id),
  name text not null,
  active boolean not null default true,
  api_key text not null unique default extensions.gen_random_uuid()::text,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table devices (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references sources(id) on delete cascade,
  device_name text not null,
  device_type text not null,
  status text not null default 'unknown' check (status in ('online', 'offline', 'delayed', 'unknown')),
  last_seen timestamptz,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table events (
  id uuid primary key default gen_random_uuid(),
  source_id uuid references sources(id) on delete cascade,
  device_id uuid references devices(id) on delete cascade,
  event_type text not null,
  level text check (level in ('info', 'warning', 'critical', 'recovery')),
  message text,
  payload jsonb not null default '{}',
  created_at timestamptz not null default now()
);

-- ============================================================
-- Indexes
-- ============================================================

create index idx_events_source_time on events (source_id, created_at desc);
create index idx_events_device_time on events (device_id, created_at desc);
create index idx_events_level on events (level) where level is not null;

create index idx_devices_source_status on devices (source_id, status);
create index idx_sources_org_type on sources (organization_id, source_type_id);

-- ============================================================
-- RLS: Enable on all tables
-- ============================================================

alter table source_types enable row level security;
alter table sources enable row level security;
alter table devices enable row level security;
alter table events enable row level security;

-- ============================================================
-- RLS Policies: source_types (readable by all authenticated)
-- ============================================================

create policy "Authenticated users can view source_types"
  on source_types
  for select
  to authenticated
  using (true);

-- ============================================================
-- RLS Policies: sources
-- ============================================================

create policy "Super admin can manage all sources"
  on sources
  for all
  to authenticated
  using (is_super_admin())
  with check (is_super_admin());

create policy "Org members can view sources in their org"
  on sources
  for select
  to authenticated
  using (is_org_member(organization_id));

create policy "Org admin can insert sources in their org"
  on sources
  for insert
  to authenticated
  with check (is_org_admin(organization_id));

create policy "Org admin can update sources in their org"
  on sources
  for update
  to authenticated
  using (is_org_admin(organization_id));

create policy "Org admin can delete sources in their org"
  on sources
  for delete
  to authenticated
  using (is_org_admin(organization_id));

-- ============================================================
-- RLS Policies: devices
-- ============================================================

create policy "Super admin can manage all devices"
  on devices
  for all
  to authenticated
  using (is_super_admin())
  with check (is_super_admin());

create policy "Org members can view devices in their org"
  on devices
  for select
  to authenticated
  using (
    exists (
      select 1 from sources s
      where s.id = devices.source_id
        and is_org_member(s.organization_id)
    )
  );

create policy "Org admin can insert devices in their org"
  on devices
  for insert
  to authenticated
  with check (
    exists (
      select 1 from sources s
      where s.id = devices.source_id
        and is_org_admin(s.organization_id)
    )
  );

create policy "Org admin can update devices in their org"
  on devices
  for update
  to authenticated
  using (
    exists (
      select 1 from sources s
      where s.id = devices.source_id
        and is_org_admin(s.organization_id)
    )
  );

create policy "Org admin can delete devices in their org"
  on devices
  for delete
  to authenticated
  using (
    exists (
      select 1 from sources s
      where s.id = devices.source_id
        and is_org_admin(s.organization_id)
    )
  );

-- ============================================================
-- RLS Policies: events
-- ============================================================

create policy "Super admin can manage all events"
  on events
  for all
  to authenticated
  using (is_super_admin())
  with check (is_super_admin());

create policy "Org members can view events in their org"
  on events
  for select
  to authenticated
  using (
    exists (
      select 1 from sources s
      where s.id = events.source_id
        and is_org_member(s.organization_id)
    )
  );

-- Events are inserted via backend service_role only (API key auth)
-- No insert/update/delete for authenticated role

-- ============================================================
-- Column-Level Privileges: protect api_key
-- ============================================================

revoke select (api_key) on sources from authenticated, anon;
grant select (api_key) on sources to service_role;

-- ============================================================
-- Seed: source types
-- ============================================================

insert into source_types (name, display_name, description) values
  ('line_oa', 'LINE Official Account', 'LINE Messaging API channel monitoring'),
  ('google_apps_script', 'Google Apps Script', 'GAS script execution and alert monitoring'),
  ('temperature', 'Temperature Sensor', 'Temperature and humidity monitoring sensors'),
  ('iot', 'IoT Device', 'Generic IoT device online/offline tracking');
