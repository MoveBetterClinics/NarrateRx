-- Per-clinician campaign override.
--
-- Why: a workspace with multiple clinicians often has only one or two pushing
-- a given campaign (e.g., only the host clinician of an upcoming seminar
-- should be CTA'ing to it; the other clinicians stay on bookings or whatever
-- the workspace default is). Without per-clinician override every clinician's
-- new drafts get the same workspace-wide CTA — fine for a 1-person shop, but
-- noisy in a 5-clinician practice.
--
-- Shape: a JSONB column on `clinicians`. NULL = "use workspace default";
-- object present = override. Object keys mirror clinic_settings.campaign_*:
--   { mode, notes, cta_url, cta_label, cta_pitch, event_at }
--
-- Resolution at generation time lives in api/_lib/campaignSettings.js —
-- loadActiveCampaign(workspaceId, clinicianId) checks the clinician override
-- first, falls back to clinic_settings. Blog generation does NOT call this
-- — blogs remain evergreen per the lock in src/lib/campaigns.js.

ALTER TABLE public.clinicians
  ADD COLUMN IF NOT EXISTS campaign_settings jsonb;

-- clinicians already grants service_role from migration 049 / 051; restate
-- defensively per the project's "each migration is self-sufficient" rule.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.clinicians TO service_role;
