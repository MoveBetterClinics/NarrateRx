-- 086_capture_upload_token.sql
-- Per-clinician upload token for the iOS Capture Companion shortcut.
-- Phase 1 of the 30-day video output build (2026-05-27).
--
-- A clinician (or Producer with their consent) generates a long-lived
-- bearer token in NarrateRx → pastes it into their iOS Shortcut once.
-- The Shortcut then uploads photos/videos to /api/capture/upload with
-- Authorization: Bearer <token>.
--
-- Token format: plaintext, prefix 'cct_' followed by base32(24 random bytes).
-- 90-day default expiry. Rotation is cheap (DELETE + POST).
-- Stored unhashed because:
--   a) only this single endpoint reads it (no defense-in-depth gain from
--      hashing — a DB read still yields auth)
--   b) rotation is easy and ad-hoc
--   c) keeps the lookup a single equality query

ALTER TABLE public.clinicians
  ADD COLUMN IF NOT EXISTS capture_upload_token text,
  ADD COLUMN IF NOT EXISTS capture_upload_token_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS capture_upload_token_last_used_at timestamptz;

-- Unique index ensures no two clinicians can ever share a token, and
-- the WHERE clause keeps the index slim (most clinicians won't have a
-- capture token).
CREATE UNIQUE INDEX IF NOT EXISTS clinicians_capture_upload_token_uniq
  ON public.clinicians(capture_upload_token)
  WHERE capture_upload_token IS NOT NULL;

-- clinicians is already granted to service_role; no additional grants needed.
