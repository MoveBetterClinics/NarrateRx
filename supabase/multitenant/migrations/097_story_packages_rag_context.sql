-- V6 RAG fusion layer: cache the fused RAG context on each story package.
-- Atoms within the same package share one retrieval, not N independent ones.
--
-- Shape:
--   {
--     practice_chunks: [{chunk_id, score, text_preview, source_label}, ...],
--     visual_chunks:   [{chunk_id, score, asset_id, kind, similarity}, ...],
--     query_expansion: string,       -- rewritten visual query from Haiku
--     retrieved_at:    iso8601,
--     fallback_reason: string|null   -- 'no_practice_chunks'|'topic_tags_miss'|'embedding_error'|null
--   }

ALTER TABLE public.story_packages
  ADD COLUMN IF NOT EXISTS rag_context jsonb;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.story_packages TO service_role;
