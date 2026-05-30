-- Migration 111: add campaign_id to video_segments
--
-- Repurpose A2 (PR #TBD). Carries the repurpose campaign from clip PROPOSAL
-- (find-clips / detectSegmentsForAsset) through to RENDER (render-segments),
-- which sets it on the resulting story_packages row. Lets the master + all
-- its social clips share one "Repurpose" campaign so the Slate's campaign chip
-- groups them visually and the auto-publish path queues them to Buffer in
-- approval order.
--
-- Applied BEFORE merging the A2 code — see feature-repurpose-a2.md.

ALTER TABLE public.video_segments
  ADD COLUMN IF NOT EXISTS campaign_id uuid REFERENCES public.campaigns(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_video_segments_campaign
  ON public.video_segments (campaign_id)
  WHERE campaign_id IS NOT NULL;

-- Self-sufficient grants (REST API runs as service_role).
GRANT SELECT, INSERT, UPDATE, DELETE ON public.video_segments TO service_role;
