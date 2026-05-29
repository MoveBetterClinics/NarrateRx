-- Migration 105: video_segments + media_assets detection lifecycle
--
-- Multi-clip video v1 (Phase 1). One long source video (seminar / talk /
-- voice-memo video) → MANY proposed short segments instead of today's
-- one-clip-per-source. `/api/editorial/find-clips` transcribes the source
-- (Whisper, timestamped) and runs one LLM pass over the timestamped transcript
-- proposing standalone moments ({start, end, hook, why_it_stands_alone}), each
-- ≤60s, with voice-faithful clinical framing from the workspace brand voice.
--
-- The clinician reviews proposed segments on the Slate (keep/discard); each kept
-- segment renders into its own story_package via the existing capped ffmpeg
-- pipeline (`-ss <start> -t <len>`, MAX_RENDER_SECONDS=60). See the spec at
-- .claude/feature-multiclip-video.md.
--
-- Self-sufficient per CLAUDE.md: GRANTs bundled inline.

CREATE TABLE IF NOT EXISTS public.video_segments (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id        uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  source_asset_id     uuid NOT NULL REFERENCES public.media_assets(id) ON DELETE CASCADE,
  clinician_id        uuid REFERENCES public.clinicians(id) ON DELETE SET NULL,

  start_sec           numeric NOT NULL,             -- segment start offset in the source
  end_sec             numeric NOT NULL,             -- segment end offset (clamped to ≤ start+60 in code)
  hook                text NOT NULL DEFAULT '',     -- proposed standalone hook / title
  why_it_stands_alone text NOT NULL DEFAULT '',     -- model rationale (clinician-facing)
  transcript_excerpt  text NOT NULL DEFAULT '',     -- the segment's spoken words (for review)
  order_index         integer NOT NULL DEFAULT 0,   -- display order within the source

  status              text NOT NULL DEFAULT 'proposed'
                        CHECK (status IN ('proposed','kept','discarded','rendered')),
  -- Set when a kept segment is turned into a rendered story package (Phase 2).
  story_package_id    uuid REFERENCES public.story_packages(id) ON DELETE SET NULL,

  detection_model     text,                         -- LLM model that proposed this segment
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_video_segments_workspace
  ON public.video_segments (workspace_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_video_segments_source_asset
  ON public.video_segments (source_asset_id, order_index);

-- Auto-update updated_at on row changes.
CREATE OR REPLACE FUNCTION public.set_video_segments_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_video_segments_updated_at ON public.video_segments;
CREATE TRIGGER trg_video_segments_updated_at
  BEFORE UPDATE ON public.video_segments
  FOR EACH ROW EXECUTE FUNCTION public.set_video_segments_updated_at();

-- Detection lifecycle on the source asset. The transcribe + LLM pass runs off
-- the request path (waitUntil + 202), so the UI polls these columns while it
-- works. segment_status: null (never run) | 'detecting' | 'ready' | 'failed'.
-- segment_error doubles as a non-fatal note carrier on success (e.g. "source
-- truncated to first 90 min for detection") — the UI shows it as info when
-- segment_status='ready'.
ALTER TABLE public.media_assets
  ADD COLUMN IF NOT EXISTS segment_status       text,
  ADD COLUMN IF NOT EXISTS segment_error        text,
  ADD COLUMN IF NOT EXISTS segments_detected_at timestamptz;

-- Required: service_role must read/write (REST API runs as service_role).
GRANT SELECT, INSERT, UPDATE, DELETE ON public.video_segments TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.media_assets TO service_role;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO service_role;
