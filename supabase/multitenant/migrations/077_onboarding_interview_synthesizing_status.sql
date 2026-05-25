-- 077_onboarding_interview_synthesizing_status.sql
--
-- Add 'synthesizing' to the allowed workspace_onboarding_interviews.status
-- values. Used by api/onboarding/synthesize.js as an atomic claim state to
-- prevent two concurrent synthesis requests from both passing the
-- `status='completed'` gate, both calling Claude (~30s), and both writing
-- to workspaces.brand_voice / patient_context / topic_suggestions and
-- doubling the clinician_voice_phrases upserts (P0-2, audit 2026-05-24).
--
-- Flow:
--   completed  --(atomic PATCH, conditional)-->  synthesizing
--   synthesizing --(on success)-->                synthesized
--   synthesizing --(on failure)-->                completed   (retryable)
--
-- The unnamed inline CHECK constraint from 061 gets the default name
-- `workspace_onboarding_interviews_status_check`. Drop and recreate.
-- Idempotent: re-applying after the new constraint is in place is a no-op.

alter table public.workspace_onboarding_interviews
  drop constraint if exists workspace_onboarding_interviews_status_check;

alter table public.workspace_onboarding_interviews
  add constraint workspace_onboarding_interviews_status_check
  check (status in ('in_progress','completed','synthesizing','synthesized','abandoned'));
