-- 103_broll_columns.sql
--
-- Adds V3 synthetic b-roll tracking columns to story_packages.
-- Applied to the shared narraterx Supabase project only.
--
-- When the editorial pipeline finds no real clips for a topic it falls back
-- to Runway Gen-3 Alpha (text-to-video). These columns track the async
-- generation state so the Slate can show progress and the cron can retry
-- failed jobs.

ALTER TABLE public.story_packages
  -- 'generating' while Runway job is in flight
  -- 'complete'   once video is downloaded, uploaded to Blob, and renders updated
  -- 'failed'     Runway failed or timed out — package may be empty
  -- 'skipped'    RUNWAY_API_KEY not configured — fell back to 409
  ADD COLUMN IF NOT EXISTS broll_status text
    CHECK (broll_status IN ('generating', 'complete', 'failed', 'skipped')),

  -- Runway task ID for status polling / retry
  ADD COLUMN IF NOT EXISTS broll_task_id text,

  -- Model that generated the footage ('gen3a_turbo' or future alternatives)
  ADD COLUMN IF NOT EXISTS broll_model text,

  -- The text prompt sent to Runway (stored for audit + prompt improvement)
  ADD COLUMN IF NOT EXISTS broll_prompt text;

-- Fast lookup: Slate "generating" badge query + cron retry scan
CREATE INDEX IF NOT EXISTS story_packages_broll_status_idx
  ON public.story_packages (workspace_id, broll_status)
  WHERE broll_status IS NOT NULL;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.story_packages TO service_role;
