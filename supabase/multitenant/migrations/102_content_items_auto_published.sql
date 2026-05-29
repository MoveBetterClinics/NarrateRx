-- Migration 102: auto_published flag on content_items
--
-- Distinguishes items shipped by the auto-publish cron from items
-- that a human manually dispatched through the UI.
-- Used by the engagement digest (which clinicians drove traffic via
-- auto-publish vs. manual) and the auto-publish audit log.

ALTER TABLE public.content_items
  ADD COLUMN IF NOT EXISTS auto_published boolean NOT NULL DEFAULT false;

-- The engagement cron and digest query auto-published items separately
-- from manual ones to surface channel ROI comparison.
CREATE INDEX IF NOT EXISTS idx_content_items_auto_published
  ON public.content_items (workspace_id, platform, published_at DESC)
  WHERE auto_published = true AND status = 'published';

GRANT SELECT, INSERT, UPDATE, DELETE ON public.content_items TO service_role;
