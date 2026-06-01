alter table channels
  add column webhook_status text not null default 'unknown'
    check (webhook_status in ('online', 'offline', 'unknown')),
  add column webhook_checked_at timestamptz;
