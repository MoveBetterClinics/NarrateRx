-- Migration 081 — unique title index on clinician_corpus_documents.
--
-- The clinician_corpus_documents table was created in migration 079.
-- The practice_memory_chunks source_type CHECK was widened in migration 078.
-- Neither is touched here.
--
-- This migration adds one thing migration 079 omitted: a unique index on
-- (workspace_id, clinician_id, doc_type, title) so the ingest endpoint can
-- do idempotent upserts with PostgREST's on_conflict= parameter. Without
-- this index, re-saving a draft with the same title inserts a duplicate row
-- instead of updating the existing one.

CREATE UNIQUE INDEX IF NOT EXISTS clinician_corpus_docs_title_uniq_idx
  ON public.clinician_corpus_documents (workspace_id, clinician_id, doc_type, title)
  WHERE archived_at IS NULL;
