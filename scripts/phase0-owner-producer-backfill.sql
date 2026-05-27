-- phase0-owner-producer-backfill.sql
-- One-off data updates for Phase 0 of the 30-day video output build (2026-05-26).
-- NOT a tracked migration — apply manually after D1 approval via Supabase SQL Editor
-- or apply_migration with a custom name.
--
-- IDs verified by Phase 0 lookup at session start:
--   workspace movebetter-people = 76faa447-b1f4-4038-babc-4d86536b049d
--   clinician Dr. Q              = ecc80e20-40af-49dd-9879-e79f65656e6b
--                                  user_id = user_3DWDihgcc6OPc5eVvYkZO9sgqVt
--   clinician Philip Abraham III = fd01e7b1-9f95-44c0-9c45-09ed08f13f9f
--                                  user_id = NULL (proxy row, needs Clerk linkage)
--
-- Pre-requisite: migrations 083, 084, 085 must be applied first.

BEGIN;

-- 1. Backfill workspace owner Clerk ID on Move Better People.
UPDATE public.workspaces
SET
  created_by_clerk_user_id = 'user_3DWDihgcc6OPc5eVvYkZO9sgqVt',
  legal_name = COALESCE(legal_name, 'Move Better, LLC'),
  updated_at = now()
WHERE id = '76faa447-b1f4-4038-babc-4d86536b049d'
  AND created_by_clerk_user_id IS NULL;

-- 2. Promote Q to Owner + add legal_name. Keeps name='Dr. Q' (user-facing).
UPDATE public.clinicians
SET
  permission_tier = 'owner',
  legal_name = 'Michael Quasney',
  updated_at = now()
WHERE id = 'ecc80e20-40af-49dd-9879-e79f65656e6b';

-- 3. Promote Philip to Producer + flag as non-clinical staff.
--    NOTE: clinicians.user_id is still NULL. After D1, Q will provide Philip's
--    Clerk user_id (or we'll fetch it via Clerk Admin API). Update will look like:
--      UPDATE public.clinicians
--      SET user_id = '<philip_clerk_user_id>'
--      WHERE id = 'fd01e7b1-9f95-44c0-9c45-09ed08f13f9f';
--    This is a separate step to keep the backfill atomic if the Clerk lookup
--    isn't ready when the rest of Phase 0 ships.
UPDATE public.clinicians
SET
  staff_type = 'non_clinical_staff',
  permission_tier = 'producer',
  updated_at = now()
WHERE id = 'fd01e7b1-9f95-44c0-9c45-09ed08f13f9f';

COMMIT;

-- Verification queries to run after commit:
--   SELECT permission_tier, staff_type, legal_name, name FROM public.clinicians
--     WHERE id IN ('ecc80e20-40af-49dd-9879-e79f65656e6b',
--                  'fd01e7b1-9f95-44c0-9c45-09ed08f13f9f');
--   SELECT created_by_clerk_user_id, legal_name FROM public.workspaces
--     WHERE id = '76faa447-b1f4-4038-babc-4d86536b049d';
