-- Adds the body-copy CTA pitch — the one-sentence invitation the model uses
-- INSIDE social/email/video body copy, distinct from campaign_cta_label
-- (which is the short button text used on platforms with a literal button).
--
-- Without this, the model invents its own pitch sentence around the link and
-- frequently drifts (wrong day, wrong topic framing). Supplying the pitch as
-- structured workspace input keeps every channel's body-copy invitation
-- aligned and on-message.
--
-- Companion to migration 062 (campaign CTA fields).

ALTER TABLE public.clinic_settings
  ADD COLUMN IF NOT EXISTS campaign_cta_pitch text;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.clinic_settings TO service_role;
