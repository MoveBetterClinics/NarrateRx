-- Tier 1 of the exemplar feedback loop: a manual "this post performed well"
-- flag editors set after seeing engagement results. Future AI prompt passes
-- pull the top N flagged rows per platform as in-context exemplars.
--
-- Buffer/GA4 backed scoring (Tier 2/3) can layer on top later without
-- changing this column — they'd just auto-flip the flag based on metrics.

ALTER TABLE public.content_items
  ADD COLUMN IF NOT EXISTS performed_well boolean NOT NULL DEFAULT false;

-- Partial index — only the (rare) flagged rows are worth indexing, since
-- exemplar reads filter by `performed_well = true AND platform = ?` and the
-- default value matches the vast majority of rows.
CREATE INDEX IF NOT EXISTS content_items_performed_well_idx
  ON public.content_items (workspace_id, platform, published_at DESC)
  WHERE performed_well = true;
