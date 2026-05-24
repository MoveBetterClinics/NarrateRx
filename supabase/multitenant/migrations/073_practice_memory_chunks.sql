-- Phase 5 Feature 2 PR 3 — RAG layer for practice memory.
--
-- The hot tier (PRs #789/#794/#796) always-injects ~5–10k tokens of the
-- clinician's recent interview summaries + approved content + voice phrases
-- into every generation prompt. That covers the common case but goes blind
-- when the relevant prior thinking is older than the hot window.
--
-- This table holds embedded chunks of the clinician's entire corpus so a
-- generation handler can vector-search "what else has this clinician said
-- about THIS topic?" before composing the YOUR PRIOR THINKING block.
--
-- Sources indexed:
--   - interview_summary  — one chunk per interviews.summary_text
--   - content_item       — paragraph-level chunks of approved/published bodies
--   - voice_phrase       — one chunk per clinician_voice_phrases.phrase
--
-- Embedding model: OpenAI text-embedding-3-small (1536 dims).

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS public.practice_memory_chunks (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,

  -- Nullable for content authored without a clinician attribution
  -- (proxy captures). Retrieval that scopes by clinician will simply skip
  -- these rows; workspace-level retrieval will include them.
  clinician_id  uuid REFERENCES public.clinicians(id) ON DELETE CASCADE,

  -- Provenance. (source_type, source_id, chunk_index) is unique so the
  -- indexer can safely re-run on a single source row without dedup logic.
  source_type   text NOT NULL CHECK (source_type IN ('interview_summary','content_item','voice_phrase')),
  source_id     uuid NOT NULL,
  chunk_index   integer NOT NULL DEFAULT 0,

  -- Short human-readable label rendered alongside the retrieved snippet so
  -- the model knows whether it's looking at an interview, a blog post, etc.
  source_label  text,

  text          text NOT NULL,
  tokens        integer,
  embedding     vector(1536),

  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS practice_memory_chunks_source_uniq_idx
  ON public.practice_memory_chunks (source_type, source_id, chunk_index);

-- Pre-filter index for the workspace + clinician scope that every retrieval
-- query applies before the HNSW scan.
CREATE INDEX IF NOT EXISTS practice_memory_chunks_scope_idx
  ON public.practice_memory_chunks (workspace_id, clinician_id);

-- HNSW over cosine distance. Chosen over IVFFlat because the corpus grows
-- continuously (every approved interview/content piece adds rows) and HNSW
-- does not require periodic retraining of list centroids.
CREATE INDEX IF NOT EXISTS practice_memory_chunks_embedding_idx
  ON public.practice_memory_chunks USING hnsw (embedding vector_cosine_ops);

CREATE OR REPLACE FUNCTION public.practice_memory_chunks_touch_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS practice_memory_chunks_touch_updated_at ON public.practice_memory_chunks;
CREATE TRIGGER practice_memory_chunks_touch_updated_at
  BEFORE UPDATE ON public.practice_memory_chunks
  FOR EACH ROW EXECUTE FUNCTION public.practice_memory_chunks_touch_updated_at();

GRANT SELECT, INSERT, UPDATE, DELETE ON public.practice_memory_chunks TO service_role;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO service_role;
GRANT EXECUTE ON FUNCTION public.practice_memory_chunks_touch_updated_at() TO service_role;
