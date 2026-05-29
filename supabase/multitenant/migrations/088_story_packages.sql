-- Migration 088: story_packages
--
-- Stores generated story packages from the Phase 2 Day 8 editorial pipeline.
-- A story package = topic + best-matching clip + caption + per-channel renders.
-- Phase 3 (Story Director UI) reads this table to present packages for clinician
-- approval and distribution.

CREATE TABLE IF NOT EXISTS public.story_packages (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id     uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  clinician_id     uuid REFERENCES public.clinicians(id) ON DELETE SET NULL,
  source_asset_id  uuid REFERENCES public.media_assets(id) ON DELETE SET NULL,

  topic            text NOT NULL DEFAULT '',
  caption_text     text NOT NULL DEFAULT '',
  similarity       float,                          -- cosine similarity of top clip
  channels         text[] NOT NULL DEFAULT '{}',
  renders          jsonb NOT NULL DEFAULT '[]',     -- [{channel, blobUrl, width, height, sizeBytes, hadSubtitles?}]

  status           text NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending', 'generating', 'complete', 'failed')),
  error_message    text,

  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

-- Indexes for the most common query patterns.
CREATE INDEX IF NOT EXISTS idx_story_packages_workspace_id
  ON public.story_packages (workspace_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_story_packages_clinician_id
  ON public.story_packages (clinician_id)
  WHERE clinician_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_story_packages_status
  ON public.story_packages (workspace_id, status);

-- Auto-update updated_at on row changes.
CREATE OR REPLACE FUNCTION public.set_story_packages_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_story_packages_updated_at ON public.story_packages;
CREATE TRIGGER trg_story_packages_updated_at
  BEFORE UPDATE ON public.story_packages
  FOR EACH ROW EXECUTE FUNCTION public.set_story_packages_updated_at();

-- Required: service_role must be able to read/write (REST API runs as service_role).
GRANT SELECT, INSERT, UPDATE, DELETE ON public.story_packages TO service_role;
