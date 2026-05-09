-- Grant the Supabase service_role full access to the multi-tenant schema.
--
-- Required because tables created via direct postgres-superuser connection
-- (the migration runner) don't auto-grant to PostgREST's runtime roles the
-- way the Supabase dashboard's table editor does. Without these grants, the
-- middleware's REST API lookups against /rest/v1/workspaces (and every other
-- table) return 403 "permission denied for table".
--
-- service_role bypasses Row-Level Security; we use it from server-side code
-- only. Phase 1B+ will add anon/authenticated grants with proper RLS once
-- Clerk auth is wired in.

grant usage on schema public to service_role;

grant all privileges on all tables    in schema public to service_role;
grant all privileges on all sequences in schema public to service_role;
grant all privileges on all functions in schema public to service_role;

-- Default privileges so newly-created tables inherit the same grants.
alter default privileges in schema public grant all on tables    to service_role;
alter default privileges in schema public grant all on sequences to service_role;
alter default privileges in schema public grant all on functions to service_role;
