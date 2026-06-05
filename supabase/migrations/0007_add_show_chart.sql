-- Add show_chart column to public_configs
alter table public_configs add column if not exists show_chart boolean not null default true;