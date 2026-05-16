-- Link a media_asset to the clinician it features (optional — set at upload
-- time when the uploader selects a specific clinician, or left null for
-- multi-person / unknown clips). Used by the Media Hub clinician filter and
-- by the voice-phrase backfill to associate interview clips with voice profiles.

ALTER TABLE public.media_assets
  ADD COLUMN IF NOT EXISTS clinician_id uuid references public.clinicians(id) on delete set null;

CREATE INDEX IF NOT EXISTS media_assets_clinician_idx
  ON public.media_assets (clinician_id)
  WHERE clinician_id IS NOT NULL;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.media_assets TO service_role;
