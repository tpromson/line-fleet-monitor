-- Block authenticated/anonymous from inserting/updating api_key (only service_role can set it)
revoke insert (api_key) on sources from authenticated, anon;
revoke update (api_key) on sources from authenticated, anon;

-- Add index for event_type filtering (used heavily by dashboard and chart queries)
create index idx_events_event_type on events(event_type);
