alter table sources
  add column channel_id uuid references channels(id) on delete set null;

create index idx_sources_channel on sources(channel_id);
