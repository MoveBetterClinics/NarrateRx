-- 051_clinician_user_id.sql
--
-- Binds each clinician row to a stable Clerk user identity (when the
-- clinician is a Self-clinician — i.e. the Clerk user IS the clinician).
-- This fixes the "rename your display name → new clinician row" bug by
-- making identity = user_id, not name. The `name` field becomes a free-
-- floating label that can change anytime without orphaning recipes,
-- interviews, voice notes, etc.
--
-- For "proxy" clinicians — recorded by an admin on behalf of someone who
-- doesn't have a Clerk account (guest expert, etc.) — `user_id` is NULL
-- and lookup falls back to the existing name-based path.
--
-- The clinicians.created_by_id audit field stays as-is (it records who
-- first created the row, not who the clinician IS).

alter table public.clinicians
  add column if not exists user_id text;

-- Fast lookup by (workspace, user) — used on every getOrCreateClinician
-- call when the typed name matches the logged-in user's display name.
create index if not exists clinicians_workspace_user_idx
  on public.clinicians (workspace_id, user_id)
  where user_id is not null;

-- Backfill an `updated_at` column the API has been silently referencing
-- via PATCH for a while. Defaults to created_at so existing rows have a
-- sensible value rather than nulls.
alter table public.clinicians
  add column if not exists updated_at timestamptz;

update public.clinicians set updated_at = created_at where updated_at is null;

alter table public.clinicians
  alter column updated_at set default now();

grant select, insert, update, delete on public.clinicians to service_role;
