-- ============================================================
-- Migrate Legacy 25°C Reconnect Outliers
-- ============================================================
-- One-time data migration: move existing events matching the
-- 25°C first-after-reconnect pattern to outlier_logs, then
-- remove from events table.
--
-- Criteria (per device_id):
--   - event_type IN ('TEMP_NORMAL', 'HIGH_TEMP', 'heartbeat')
--   - temperature OR lastTemperature ≈ 25 (±0.1)
--   - first event ever for this device, OR
--     gap from previous event > 5 minutes
-- ============================================================

begin;

-- ------------------------------------------------------------
-- Step 1: Insert into outlier_logs
-- ------------------------------------------------------------
with ordered_events as (
  select
    e.id,
    e.source_id,
    e.device_id,
    e.event_type,
    e.payload,
    e.created_at,
    lag(e.created_at) over (
      partition by e.device_id
      order by e.created_at
    ) as prev_created_at
  from events e
  where e.device_id is not null
    and e.event_type in ('TEMP_NORMAL', 'HIGH_TEMP', 'heartbeat')
),
outlier_candidates as (
  select *
  from ordered_events
  where (
    prev_created_at is null
    or extract(epoch from (created_at - prev_created_at)) > 300
  )
  and (
    (payload->>'temperature' is not null
      and abs((payload->>'temperature')::numeric - 25) <= 0.1)
    or (payload->>'lastTemperature' is not null
      and abs((payload->>'lastTemperature')::numeric - 25) <= 0.1)
  )
)
insert into outlier_logs (source_id, device_id, event_type, reason, temperature, humidity, payload, created_at)
select
  source_id,
  device_id,
  event_type,
  'reconnect_25c_legacy' as reason,
  coalesce(
    (payload->>'temperature')::numeric,
    (payload->>'lastTemperature')::numeric
  ) as temperature,
  coalesce(
    (payload->>'humidity')::numeric,
    (payload->>'lastHumidity')::numeric
  ) as humidity,
  payload,
  created_at
from outlier_candidates;

-- ------------------------------------------------------------
-- Step 2: Delete from events
-- ------------------------------------------------------------
with ordered_events as (
  select
    e.id,
    lag(e.created_at) over (
      partition by e.device_id
      order by e.created_at
    ) as prev_created_at
  from events e
  where e.device_id is not null
    and e.event_type in ('TEMP_NORMAL', 'HIGH_TEMP', 'heartbeat')
),
outlier_candidates as (
  select id
  from ordered_events
  where (
    prev_created_at is null
    or extract(epoch from (created_at - prev_created_at)) > 300
  )
  and (
    (payload->>'temperature' is not null
      and abs((payload->>'temperature')::numeric - 25) <= 0.1)
    or (payload->>'lastTemperature' is not null
      and abs((payload->>'lastTemperature')::numeric - 25) <= 0.1)
  )
)
delete from events
where id in (select id from outlier_candidates);

commit;

-- ============================================================
-- Verification queries (run separately):
-- ============================================================
-- select count(*) as migrated_outliers
--   from outlier_logs
--  where reason = 'reconnect_25c_legacy';
--
-- select count(*) as remaining_suspect
--   from events
--  where device_id is not null
--    and event_type in ('TEMP_NORMAL', 'HIGH_TEMP', 'heartbeat')
--    and (
--      (payload->>'temperature' is not null
--        and abs((payload->>'temperature')::numeric - 25) <= 0.1)
--      or (payload->>'lastTemperature' is not null
--        and abs((payload->>'lastTemperature')::numeric - 25) <= 0.1)
--    );
