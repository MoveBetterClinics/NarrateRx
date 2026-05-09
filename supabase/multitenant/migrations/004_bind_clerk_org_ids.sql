-- Bind Clerk Organization IDs to the three Move Better workspaces.
--
-- Clerk app: NarrateRx (new shared app, Development mode, Organizations enabled,
-- Membership required ON, invite-only). Created 2026-05-09 for Phase 1B.
--
-- The clerk_org_id column already exists (001_init.sql); it was seeded NULL
-- in 002_seed_movebetter.sql pending this provisioning step.
--
-- Run via: node scripts/apply-multitenant-migrations.mjs supabase/multitenant/migrations/004_bind_clerk_org_ids.sql

update workspaces set clerk_org_id = 'org_3DV1gIBLwmfPqFKVsaJt8V8MoGp' where slug = 'movebetter-people';
update workspaces set clerk_org_id = 'org_3DV1mUpF1sgPkgJ7EfszkhVH9Rz' where slug = 'movebetter-equine';
update workspaces set clerk_org_id = 'org_3DV1p9TnW7tp0jQW2HklftfO4gn' where slug = 'movebetter-animals';

-- Verify
select slug, display_name, clerk_org_id from workspaces order by slug;
