-- ============================================================
-- Outlier Logs (filtered temperature readings)
-- ============================================================

create table outlier_logs (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references sources(id) on delete cascade,
  device_id uuid references devices(id) on delete cascade,
  event_type text,
  reason text not null,
  temperature numeric,
  humidity numeric,
  payload jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create index idx_outlier_logs_source_time on outlier_logs (source_id, created_at desc);
create index idx_outlier_logs_device_time on outlier_logs (device_id, created_at desc);
create index idx_outlier_logs_reason on outlier_logs (reason);

-- ============================================================
-- RLS
-- ============================================================

alter table outlier_logs enable row level security;

create policy "Super admin can view all outlier_logs"
  on outlier_logs
  for select
  to authenticated
  using (is_super_admin());

create policy "Org members can view outlier_logs in their org"
  on outlier_logs
  for select
  to authenticated
  using (
    exists (
      select 1 from sources s
      where s.id = outlier_logs.source_id
        and is_org_member(s.organization_id)
    )
  );

-- Insert/update/delete: service_role only (backend)
