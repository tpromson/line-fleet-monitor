-- Add public sharing columns to organizations
alter table organizations
add column if not exists public_slug text unique,
add column if not exists public_enabled boolean not null default false;

-- Index for fast lookup by slug
create index if not exists idx_organizations_public_slug on organizations (public_slug) where public_slug is not null;

-- Generate slug trigger function
create or replace function generate_org_slug(org_name text)
returns text
language plpgsql
as $$
declare
  base_slug text;
  suffix text;
  final_slug text;
begin
  -- Convert to lowercase, replace spaces with hyphens, remove special chars
  base_slug := lower(regexp_replace(org_name, '[^a-zA-Z0-9\s-]', '', 'g'));
  base_slug := trim(regexp_replace(base_slug, '\s+', '-', 'g'));
  base_slug := substring(base_slug from 1 for 50); -- max 50 chars

  -- Add random suffix (6 chars)
  suffix := substring(gen_random_uuid()::text from 1 for 6);
  final_slug := base_slug || '-' || suffix;

  return final_slug;
end;
$$;

-- Update RLS for organizations to allow org admin to update public settings
drop policy if exists "Org admin can update their org public settings" on organizations;

create policy "Org admin can update their org public settings"
  on organizations
  for update
  to authenticated
  using (is_org_admin(id))
  with check (is_org_admin(id));

-- Allow org members to view their org's public slug (needed for share link display)
drop policy if exists "Members can view their org public slug" on organizations;

create policy "Members can view their org public slug"
  on organizations
  for select
  to authenticated
  using (is_org_member(id));