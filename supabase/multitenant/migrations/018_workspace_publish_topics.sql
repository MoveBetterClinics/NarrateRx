-- 018_workspace_publish_topics.sql
--
-- Adds workspaces.publish_topics — a per-workspace array of kebab-case
-- topic slugs used by the Astro+GitHub website-publish integration. The
-- UI surfaces these as a dropdown in the publish panel; editors can also
-- type a new topic, which is appended to this array and forwarded to the
-- receiving Astro site. The site auto-derives filter chips from distinct
-- topic values across posts (Movebetterco PR #43), so a new entry here
-- becomes a new chip on the next deploy with no further coordination.
--
-- Column is JSONB array of strings. Empty array = no dropdown shown
-- (receiver falls back to "general"). Per-workspace because each
-- tenant's taxonomy is different.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS; seed uses COALESCE so re-running
-- doesn't clobber later edits.

ALTER TABLE public.workspaces
  ADD COLUMN IF NOT EXISTS publish_topics jsonb NOT NULL DEFAULT '[]'::jsonb;

UPDATE public.workspaces
SET publish_topics = '["breathing","bracing","hinging","chronic-pain","postpartum","general"]'::jsonb
WHERE slug = 'movebetter-people'
  AND (publish_topics IS NULL OR publish_topics = '[]'::jsonb);
