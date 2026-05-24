-- Phase 5 Feature 3 — per-clinician voice clone (ElevenLabs Instant Voice Cloning).
--
-- A clinician records 3–5 minutes of clean audio in the voice-training lane.
-- /api/voice-clone/create uploads that to ElevenLabs IVC and stores the
-- returned voice_id here. Subsequent TTS calls that pass clinician_id resolve
-- to the clone instead of the default Bernard voice.
--
-- Consent + revocation are tracked as timestamps. A revoked clone has its
-- voice deleted at ElevenLabs and eleven_voice_id nulled out, but
-- voice_clone_revoked_at is kept so we have an audit trail.
--
-- voice_clone_sample_url is the Vercel blob URL of the training audio. We
-- keep it after upload so a clinician can re-clone (e.g., after a model
-- update) without re-recording, and so we have provenance for the clone.

ALTER TABLE public.clinicians
  ADD COLUMN IF NOT EXISTS eleven_voice_id           text,
  ADD COLUMN IF NOT EXISTS voice_clone_consent_at    timestamptz,
  ADD COLUMN IF NOT EXISTS voice_clone_revoked_at    timestamptz,
  ADD COLUMN IF NOT EXISTS voice_clone_sample_url    text;

-- Lookup index for the TTS resolver: given a workspace + clinician, fetch
-- the live (non-revoked) clone voice_id.
CREATE INDEX IF NOT EXISTS clinicians_active_voice_clone_idx
  ON public.clinicians (workspace_id, id)
  WHERE eleven_voice_id IS NOT NULL AND voice_clone_revoked_at IS NULL;

-- Per CLAUDE.md migration convention.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.clinicians TO service_role;
