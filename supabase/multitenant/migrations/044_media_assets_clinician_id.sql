-- Add optional clinician_id to media_assets so uploaded assets can be
-- attributed to the clinician who appears in them (e.g. photo of Dr. Sarah).
-- NULL means "no specific clinician" (practice-wide / b-roll asset).

ALTER TABLE public.media_assets
  ADD COLUMN IF NOT EXISTS clinician_id uuid REFERENCES public.clinicians(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS media_assets_clinician_idx
  ON public.media_assets (workspace_id, clinician_id)
  WHERE clinician_id IS NOT NULL;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.media_assets TO service_role;
