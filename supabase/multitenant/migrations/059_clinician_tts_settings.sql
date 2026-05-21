-- 059_clinician_tts_settings.sql
--
-- Per-clinician text-to-speech preferences. Stored as JSONB so we can add
-- new knobs (voice_id, model_id, stability, etc.) later without another
-- ALTER TABLE round-trip. Today the only field consumed by /api/tts is
-- { speed: number 0.7..1.2 }.

ALTER TABLE public.clinicians
  ADD COLUMN IF NOT EXISTS tts_settings jsonb NOT NULL DEFAULT '{}'::jsonb;

-- Service-role grants (per CLAUDE.md — every migration that touches a table
-- must bundle its grants inline; no relying on 003 backfill).
GRANT SELECT, INSERT, UPDATE, DELETE ON public.clinicians TO service_role;
