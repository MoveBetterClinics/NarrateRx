-- Add Vancouver, WA as a second location on the movebetter-people workspace.
--
-- Background: 010_workspace_locations.sql seeded movebetter-people with a
-- single Portland row. Move Better's human chiropractic practice actually
-- operates two clinics (Portland + Vancouver), matching the animals workspace
-- footprint. This adds the missing row so per-post location targeting works
-- on people just like it does on animals, and so each location can carry its
-- own Buffer GBP channel ID for the GBP-via-Buffer routing introduced in 012.
--
-- Idempotent: skips the insert if a Vancouver row already exists for people.

insert into workspace_locations
  (workspace_id, label, city, region, location_keyword, location_hashtag, visit_url, is_primary, position)
select
  w.id, 'Vancouver', 'Vancouver', 'WA',
  'Vancouver', null,
  null,
  false, 1
from workspaces w
where w.slug = 'movebetter-people'
  and not exists (
    select 1 from workspace_locations wl
    where wl.workspace_id = w.id and wl.city = 'Vancouver'
  );
