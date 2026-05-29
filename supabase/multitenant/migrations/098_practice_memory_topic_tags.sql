-- V6 RAG fusion layer: topic_tags column on practice_memory_chunks.
-- Extracted by Haiku at index time. GIN-indexed for pre-filter before vector
-- search to speed retrieval on large corpora.
--
-- Backfill: scripts/backfill-topic-tags.mjs tags every existing row where
-- topic_tags IS NULL OR topic_tags = '[]'. Run once after this migration.

ALTER TABLE public.practice_memory_chunks
  ADD COLUMN IF NOT EXISTS topic_tags jsonb DEFAULT '[]'::jsonb;

CREATE INDEX IF NOT EXISTS practice_memory_chunks_topic_tags_gin
  ON public.practice_memory_chunks USING gin (topic_tags);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.practice_memory_chunks TO service_role;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO service_role;
