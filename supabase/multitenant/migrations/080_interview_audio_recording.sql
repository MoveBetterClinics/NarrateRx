-- Migration 080 — interview audio recording for voice clone training.
--
-- Stores the Vercel Blob URL of the raw microphone audio captured during
-- a NarrateRx interview. Used exclusively for ElevenLabs voice clone
-- re-training — it contains the clinician's natural, unscripted speech
-- and is the gold-standard training source for the voice model.
--
-- The column is nullable: NULL means no audio was captured (older
-- interviews, interviews where capture was declined or failed silently).
-- Populated by the client-side MediaRecorder hook + api/interviews/audio.js
-- token endpoint after the interview reaches status='completed'.

ALTER TABLE public.interviews
  ADD COLUMN IF NOT EXISTS audio_recording_url text;

-- Index for the reclone script: fetch all interviews with audio for a
-- given clinician, ordered by recency so the script can cap at N files.
CREATE INDEX IF NOT EXISTS interviews_audio_recording_idx
  ON public.interviews (clinician_id, created_at DESC)
  WHERE audio_recording_url IS NOT NULL;

-- Per CLAUDE.md: service_role already has access to interviews from prior
-- migrations, but grant is idempotent so safe to include.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.interviews TO service_role;
