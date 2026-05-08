-- Phase 3 — additive columns on media_assets:
-- Run this in your Supabase SQL Editor on EACH brand's Supabase instance
-- (people, equine, animals). Supabase Dashboard → SQL Editor → New Query.
--
-- 1. visual_narrative — short narrative of what the camera shows. Phase 2's
--    Gemini pass populates this alongside transcription so the segmenter has
--    visual context for clips where the demonstration is the primary signal
--    (silent demos, non-verbal patient movement, etc.).
--
-- 2. speaker_role — distinguishes clinical-capture footage (clinician treating
--    a patient) from admin-staff interviews (operations/business stories) and
--    reserves a third role for future patient-guest content. The segmenter
--    branches its prompt on this so it surfaces the right kind of moments per
--    role. Default 'clinician' so existing uploads stay correct.

ALTER TABLE media_assets
  ADD COLUMN IF NOT EXISTS visual_narrative TEXT;

ALTER TABLE media_assets
  ADD COLUMN IF NOT EXISTS speaker_role TEXT NOT NULL DEFAULT 'clinician';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'media_assets_speaker_role_check'
  ) THEN
    ALTER TABLE media_assets
      ADD CONSTRAINT media_assets_speaker_role_check
      CHECK (speaker_role IN ('clinician', 'admin', 'patient_guest'));
  END IF;
END$$;
