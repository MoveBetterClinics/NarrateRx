-- Migration 091: per-asset consent tracking
--
-- Phase 3 PR 5 adds a simple consent flag to media_assets that gates Story
-- Slate approvals. The clinician (or any workspace member) flips this on
-- assets that depict patients or identifiable seminar attendees.
--
-- Defaults to 'not_required' so existing assets need no migration / triage.
-- The Story Director Slate's Approve action checks the source asset's
-- consent_status; 'pending' or 'revoked' blocks approval with a 409.
--
-- Values:
--   'not_required' — default; nothing to track (B-roll, brand assets, anonymous clinical work)
--   'pending'      — clinician flagged this asset; consent needs to be obtained before publish
--   'obtained'     — consent on file; safe to approve
--   'revoked'      — consent withdrawn; block approval permanently (until manually reset)
--
-- consent_updated_by stores a Clerk user id string for audit. consent_notes
-- is freeform context the clinician adds (e.g. "verbal consent obtained 2026-05-26").

ALTER TABLE public.media_assets
  ADD COLUMN IF NOT EXISTS consent_status text NOT NULL DEFAULT 'not_required',
  ADD COLUMN IF NOT EXISTS consent_notes text,
  ADD COLUMN IF NOT EXISTS consent_updated_at timestamptz,
  ADD COLUMN IF NOT EXISTS consent_updated_by text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'media_assets_consent_status_check'
  ) THEN
    ALTER TABLE public.media_assets
      ADD CONSTRAINT media_assets_consent_status_check
      CHECK (consent_status IN ('not_required', 'pending', 'obtained', 'revoked'));
  END IF;
END$$;

-- Partial index to make "show me everything pending consent" queries fast.
CREATE INDEX IF NOT EXISTS idx_media_assets_consent_pending
  ON public.media_assets (workspace_id, updated_at DESC)
  WHERE consent_status = 'pending';

-- media_assets is already granted to service_role; no additional grants needed.
