-- Migration 096: story_packages.campaign_id
--
-- Phase 4 Tentpole PR B: tags each generated story package with the campaign
-- it was generated for (NULL = generated outside any campaign window).
-- Drives the PackageCard campaign chip + lets the engagement digest break
-- down by campaign in future iterations.
--
-- ON DELETE SET NULL: archiving a campaign should not delete the packages
-- that were generated under it. The package's history of having served that
-- campaign is preserved by the snapshot fields on story_packages itself
-- (topic, caption_text, etc.) even after the campaign row is gone.

ALTER TABLE public.story_packages
  ADD COLUMN IF NOT EXISTS campaign_id uuid REFERENCES public.campaigns(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS story_packages_campaign_idx
  ON public.story_packages (workspace_id, campaign_id)
  WHERE campaign_id IS NOT NULL;
