-- Adds structured CTA fields for the workspace-singleton campaign mode
-- (lives on clinic_settings alongside campaign_mode + campaign_notes).
--
-- Why this exists: the campaign mode (bookings/seminars/referrals) was being
-- saved but had no way to inject a real CTA URL into AI-generated derivative
-- content (social posts, email/newsletter excerpts, video scripts). The model
-- guessed at URLs or omitted them — useless for a quarterly seminar push that
-- needs every social post to point at the actual RSVP landing page.
--
-- These three fields hold the structured CTA per active campaign mode.
-- Blog posts intentionally do NOT consume these — blogs are evergreen.

ALTER TABLE public.clinic_settings
  ADD COLUMN IF NOT EXISTS campaign_cta_url    text,
  ADD COLUMN IF NOT EXISTS campaign_cta_label  text,
  ADD COLUMN IF NOT EXISTS campaign_event_at   timestamptz;

-- clinic_settings already has service_role grants from earlier migrations;
-- restate defensively since each migration is meant to be self-sufficient.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.clinic_settings TO service_role;
