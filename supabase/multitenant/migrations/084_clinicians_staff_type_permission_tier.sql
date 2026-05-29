-- 084_clinicians_staff_type_permission_tier.sql
-- Adds staff_type, permission_tier, display_name, and legal_name to clinicians.
-- Phase 0 of the 30-day video output build (2026-05-26).
--
-- staff_type honors the team-as-talent principle (memory/principle_team_as_talent.md):
--   ALL team members are interviewable regardless of staff_type.
--   The flag is for content-lane routing, NOT interview gating.
--
-- permission_tier formalizes the Owner / Producer / Clinician / Viewer roles.
--   Today, workspace owners are implicit (whoever created the Clerk org).
--   This makes the role explicit on the clinicians row so Producer scope is enforceable.
--
-- legal_name supports the Q ↔ Michael Quasney naming split (memory/owner_identity_q.md).
--   `name` column stays as the user-facing display name (e.g., 'Dr. Q').
--   `legal_name` carries the legal/billing name (e.g., 'Michael Quasney').

ALTER TABLE public.clinicians
  ADD COLUMN IF NOT EXISTS staff_type text NOT NULL DEFAULT 'clinician',
  ADD COLUMN IF NOT EXISTS permission_tier text NOT NULL DEFAULT 'clinician',
  ADD COLUMN IF NOT EXISTS legal_name text;

-- CHECK constraints — guarded by NOT EXISTS pattern via DO block since
-- ADD CONSTRAINT IF NOT EXISTS isn't supported on PostgreSQL < 9.6 syntax.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'clinicians_staff_type_check'
  ) THEN
    ALTER TABLE public.clinicians
      ADD CONSTRAINT clinicians_staff_type_check
      CHECK (staff_type IN ('clinician', 'non_clinical_staff'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'clinicians_permission_tier_check'
  ) THEN
    ALTER TABLE public.clinicians
      ADD CONSTRAINT clinicians_permission_tier_check
      CHECK (permission_tier IN ('owner', 'producer', 'clinician', 'viewer'));
  END IF;
END$$;

-- clinicians is already granted to service_role; no additional grants needed.
