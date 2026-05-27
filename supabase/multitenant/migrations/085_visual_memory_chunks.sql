-- 085_visual_memory_chunks.sql
-- Visual practice memory: embeddings on every captured clip / cover frame.
-- Sister table to practice_memory_chunks (073), but for visual content.
-- Phase 0 of the 30-day video output build (2026-05-26).
--
-- Each row = one chunk of visual content with its embedding + provenance.
-- Used by clip-pull AI (Phase 2) to retrieve top-K matching clips by topic.
--
-- Relies on pgvector extension (already installed via migration 073).

CREATE TABLE IF NOT EXISTS public.visual_memory_chunks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  clinician_id uuid REFERENCES public.clinicians(id) ON DELETE SET NULL,

  -- Provenance
  source_type text NOT NULL,  -- 'media_asset' | 'cover_frame' | 'clip'
  source_id uuid,             -- references media_assets.id when applicable
  source_blob_url text,       -- canonical url to the asset chunk

  -- Auto-tagging output (from GPT-4o vision pass on ingest)
  tags jsonb NOT NULL DEFAULT '{}'::jsonb,
    -- shape: { people: [], action: '', location_hint: '', topics: [], ... }
  audio_quality real,         -- 0.0 - 1.0 (null if no audio)
  video_quality real,         -- 0.0 - 1.0
  story_role text,            -- 'intro' | 'demo' | 'punchline' | 'transition' | 'broll' | null

  -- Embedding for vector search
  embedding vector(1536),     -- text-embedding-3-small dimensions

  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT visual_memory_chunks_source_type_check
    CHECK (source_type IN ('media_asset', 'cover_frame', 'clip')),
  CONSTRAINT visual_memory_chunks_audio_quality_range
    CHECK (audio_quality IS NULL OR (audio_quality >= 0 AND audio_quality <= 1)),
  CONSTRAINT visual_memory_chunks_video_quality_range
    CHECK (video_quality >= 0 AND video_quality <= 1)
);

CREATE INDEX IF NOT EXISTS visual_memory_chunks_workspace_idx
  ON public.visual_memory_chunks(workspace_id);
CREATE INDEX IF NOT EXISTS visual_memory_chunks_clinician_idx
  ON public.visual_memory_chunks(clinician_id);
CREATE INDEX IF NOT EXISTS visual_memory_chunks_source_idx
  ON public.visual_memory_chunks(source_type, source_id);
CREATE INDEX IF NOT EXISTS visual_memory_chunks_story_role_idx
  ON public.visual_memory_chunks(story_role) WHERE story_role IS NOT NULL;

-- pgvector cosine index for retrieval
CREATE INDEX IF NOT EXISTS visual_memory_chunks_embedding_idx
  ON public.visual_memory_chunks USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);

-- Grants — required because this is a new table.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.visual_memory_chunks TO service_role;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO service_role;
