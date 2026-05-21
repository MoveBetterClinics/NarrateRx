-- Onboarding interview tracking. The founder of a newly-created workspace
-- runs a one-time ~15-minute interview that synthesizes into workspace
-- voice fields + their own clinician voice_phrases row. The "Finish
-- onboarding" Home card surfaces while this timestamp is NULL.
--
-- Note: we deliberately do NOT add an 'onboarding' value to the
-- workspaces_prompt_mode_check constraint. prompt_mode is a permanent
-- workspace setting (clinical vs general); the onboarding interview is
-- a transient activity that runs through its own dedicated route +
-- prompt function (getOnboardingInterviewSystemPrompt in src/lib/prompts.js).
-- Tracking completion in a separate column keeps prompt_mode semantically
-- clean.

ALTER TABLE public.workspaces
  ADD COLUMN IF NOT EXISTS onboarding_interview_completed_at timestamptz;

-- service_role already has full grants from migration 003; no additional
-- grants needed for an added column.
