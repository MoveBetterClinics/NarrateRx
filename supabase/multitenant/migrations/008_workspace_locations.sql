-- Multi-location support — first-class location entity.
--
-- Background: workspaces.location was a single freeform string ("Portland, OR")
-- that prompts interpolate into copy + hashtags. Move Better Animals operates
-- two clinics (Portland + Vancouver) and was kludged as
-- "Portland, OR & Vancouver, WA" in 002_seed_movebetter.sql, which means every
-- post mentions both cities and shares one hashtag. This migration adds a
-- proper one-to-many table; PR A captures the data, PR B teaches prompts +
-- GBP to use it per-post.
--
-- workspaces.location / location_keyword / location_hashtag stay as the
-- "primary location" snapshot — they're derived from the row marked
-- is_primary=true. The locations API endpoint syncs them on every write so
-- existing prompts keep rendering correctly with no other changes.

create table workspace_locations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,

  label text not null,                          -- "Portland" / "Vancouver clinic" — admin-facing
  city text not null,                           -- "Portland"
  region text,                                  -- "OR" / "WA"
  location_keyword text,                        -- "Portland" — interpolated into prompts/hashtags
  location_hashtag text,                        -- "#PortlandPets"
  visit_url text,                               -- per-location landing page, optional

  -- GBP binding. Reconciled with workspace_credentials(service='gbp').config.location_ids
  -- in PR B; null for locations that don't have a GBP listing.
  gbp_location_id text,

  is_primary boolean not null default false,
  position integer not null default 0,
  status text not null default 'active'
    check (status in ('active','archived')),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- At most one primary per workspace (partial unique index — null-safe).
create unique index workspace_locations_one_primary_idx
  on workspace_locations(workspace_id) where is_primary;

create index workspace_locations_workspace_idx
  on workspace_locations(workspace_id);
create index workspace_locations_workspace_status_idx
  on workspace_locations(workspace_id, status);
create index workspace_locations_workspace_position_idx
  on workspace_locations(workspace_id, position);

create trigger update_workspace_locations_updated_at
  before update on workspace_locations
  for each row execute function update_updated_at_column();

-- =============================================================================
-- Seed existing workspaces.
--
-- People  → 1 row  (Portland, OR)
-- Equine  → 1 row  (Ridgefield, WA)
-- Animals → 2 rows (Portland, OR primary + Vancouver, WA)
--
-- Values mirror what already exists on the workspaces row so single-location
-- prompts keep rendering identically. Animals gets the second location it
-- always needed.
-- =============================================================================
insert into workspace_locations
  (workspace_id, label, city, region, location_keyword, location_hashtag, visit_url, is_primary, position)
select
  w.id, 'Portland', 'Portland', 'OR',
  'Portland', '#PortlandChiropractor',
  'https://www.movebetter.co/',
  true, 0
from workspaces w where w.slug = 'movebetter-people';

insert into workspace_locations
  (workspace_id, label, city, region, location_keyword, location_hashtag, visit_url, is_primary, position)
select
  w.id, 'Ridgefield', 'Ridgefield', 'WA',
  'Southwest Washington', '#PNWEquestrian',
  'https://movebetterequine.com/contact/',
  true, 0
from workspaces w where w.slug = 'movebetter-equine';

insert into workspace_locations
  (workspace_id, label, city, region, location_keyword, location_hashtag, visit_url, is_primary, position)
select
  w.id, 'Portland', 'Portland', 'OR',
  'Portland', '#PortlandPets',
  'https://movebetteranimal.co/visit/portland',
  true, 0
from workspaces w where w.slug = 'movebetter-animals';

insert into workspace_locations
  (workspace_id, label, city, region, location_keyword, location_hashtag, visit_url, is_primary, position)
select
  w.id, 'Vancouver', 'Vancouver', 'WA',
  'Vancouver', null,
  'https://movebetteranimal.co/visit/vancouver',
  false, 1
from workspaces w where w.slug = 'movebetter-animals';

-- Normalize the Animals workspace's umbrella `location` field. Before this
-- migration it was 'Portland, OR & Vancouver, WA' (a kludge). After: just
-- the primary location, since the second clinic is now its own row. Prompts
-- already use location_keyword + location_hashtag (Portland + #PortlandPets)
-- which match the primary, so this is just label cleanup.
update workspaces
   set location = 'Portland, OR'
 where slug = 'movebetter-animals';
