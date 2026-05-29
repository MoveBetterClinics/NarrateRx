-- Migration 093: clinicians.producer_onboarded_at
--
-- Phase 4 PR 4: per-user state for the producer onboarding flow. NULL = the
-- user has not completed the first-run tour yet. Set to NOW() when they
-- finish the multi-step modal on /slate.
--
-- This is per-user-per-workspace (lives on clinicians, not on the Clerk user)
-- so a producer who later joins a second workspace as a producer goes
-- through onboarding again for that workspace (different team, different
-- conventions, different Buffer connection state).

ALTER TABLE public.clinicians
  ADD COLUMN IF NOT EXISTS producer_onboarded_at timestamptz;

COMMENT ON COLUMN public.clinicians.producer_onboarded_at IS
  'When the user completed the first-run producer onboarding modal on /slate. NULL = not yet onboarded.';
