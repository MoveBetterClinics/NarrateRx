-- Migration 110: story_package_chunks — per-piece state for the chunked
-- long-form render (keep-whole video lane, increment ④).
--
-- The keep-whole lane renders a WHOLE talk as one landscape master. A 30–60 min
-- talk can't be processed inside a single 300s Vercel function, so the render is
-- split into ~2 min pieces, each rendered in its own invocation (reusing the
-- existing windowed renderer: ffmpeg -ss <start> -t <len>), then concatenated
-- (ffmpeg concat -c copy) into one master. This table tracks each piece so the
-- self-continuing worker (and the cron safety-net that resumes a stalled chain)
-- can claim, render, and account for pieces idempotently.
--
-- Design notes:
--   • One row per (package_id, idx). UNIQUE(package_id, idx) makes piece
--     creation + the optimistic claim idempotent — a replayed worker can't
--     double-insert or double-render a piece.
--   • Claim is optimistic via PostgREST: PATCH ...?id=eq.X&status=eq.pending →
--     0 rows updated means another worker already claimed it. (No FOR UPDATE
--     SKIP LOCKED needed; the happy path is a single sequential chain and the
--     cron net only resumes genuinely-idle jobs.)
--   • The parent story_packages.status stays 'generating' for the whole chunked
--     job (chunking + stitching). 'generating' is already a CANCELABLE_STATUS
--     and already a valid terminal-write target, so the cooperative-cancel
--     contract needs NO new status value and NO change to packageStatus.js.
--     Progress (done/total) is derived from these rows.
--
-- Self-sufficient per CLAUDE.md: GRANTs bundled inline.

CREATE TABLE IF NOT EXISTS public.story_package_chunks (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  package_id    uuid NOT NULL REFERENCES public.story_packages(id) ON DELETE CASCADE,

  idx           integer NOT NULL,            -- 0-based piece index (concat order)
  start_sec     numeric NOT NULL,            -- piece start offset in the source
  dur_sec       numeric NOT NULL,            -- piece length in seconds

  status        text NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','rendering','done','failed')),
  attempts      integer NOT NULL DEFAULT 0,  -- bumped on each claim; cap retries in code

  blob_url      text,                        -- rendered piece MP4 (input to the concat step)
  width         integer,
  height        integer,
  size_bytes    bigint,
  had_subtitles boolean,
  error         text,

  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),

  UNIQUE (package_id, idx)
);

-- Claim query: next pending piece for a package, in concat order.
CREATE INDEX IF NOT EXISTS idx_story_package_chunks_claim
  ON public.story_package_chunks (package_id, status, idx);

-- Tenant-scoped sweeps (cron safety-net finds stalled jobs by workspace).
CREATE INDEX IF NOT EXISTS idx_story_package_chunks_workspace
  ON public.story_package_chunks (workspace_id, updated_at DESC);

-- Auto-update updated_at on row changes (mirrors video_segments trigger).
CREATE OR REPLACE FUNCTION public.set_story_package_chunks_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_story_package_chunks_updated_at ON public.story_package_chunks;
CREATE TRIGGER trg_story_package_chunks_updated_at
  BEFORE UPDATE ON public.story_package_chunks
  FOR EACH ROW EXECUTE FUNCTION public.set_story_package_chunks_updated_at();

-- Required: service_role must read/write (REST API runs as service_role).
GRANT SELECT, INSERT, UPDATE, DELETE ON public.story_package_chunks TO service_role;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO service_role;
