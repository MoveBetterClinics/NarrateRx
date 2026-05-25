-- Migration 079 — clinician_corpus_documents
--
-- Source-of-truth table for Original Blogs and Uploaded Drafts that a
-- clinician has ingested into their Author Mode corpus.
--
-- Author Mode's raw substrate must contain ONLY the clinician's own prose —
-- never AI-generated text. This table stores:
--
--   original_blog  — blog posts the clinician personally wrote before
--                    NarrateRx existed, or on an external platform.
--                    Supplied with a source_url for provenance.
--
--   uploaded_draft — arbitrary draft documents: typed notes, longhand scan
--                    OCR'd verbatim, voice-memo transcripts, chapter drafts.
--                    No URL required.
--
-- Each row is the single source of truth for that piece of prose. The RAG
-- indexer (practiceMemoryRag.js: indexOriginalBlog / indexUploadedDraft)
-- reads from this table and upserts into practice_memory_chunks under the
-- source_id = clinician_corpus_documents.id.
--
-- Re-indexing is idempotent: call the indexer with the same id and it
-- re-chunks + re-embeds, overwriting stale practice_memory_chunks rows.
-- Deleting a row here does NOT cascade-delete chunks — a separate cleanup
-- script (or the indexer's deleteExtraChunks helper) is required.

CREATE TABLE IF NOT EXISTS public.clinician_corpus_documents (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id   uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  clinician_id   uuid REFERENCES public.clinicians(id) ON DELETE SET NULL,

  -- 'original_blog' | 'uploaded_draft'  (mirrors practice_memory_chunks source_type)
  doc_type       text NOT NULL,
  CONSTRAINT ccd_doc_type_check CHECK (doc_type IN ('original_blog', 'uploaded_draft')),

  title          text NOT NULL,
  body           text NOT NULL,           -- full text of the document
  source_url     text,                    -- external URL (original_blog only; optional)

  -- Timestamps
  doc_date       timestamptz,             -- publish date (blog) or creation date (draft)
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),

  -- Soft-delete / archive — archived docs are excluded from re-index runs
  archived_at    timestamptz
);

-- Fast workspace-scoped list (settings screen, ingest status table)
CREATE INDEX IF NOT EXISTS ccd_workspace_idx
  ON public.clinician_corpus_documents (workspace_id, clinician_id, created_at DESC)
  WHERE archived_at IS NULL;

-- Trigger: keep updated_at current
CREATE OR REPLACE FUNCTION public.ccd_set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS ccd_updated_at ON public.clinician_corpus_documents;
CREATE TRIGGER ccd_updated_at
  BEFORE UPDATE ON public.clinician_corpus_documents
  FOR EACH ROW EXECUTE FUNCTION public.ccd_set_updated_at();

-- Per CLAUDE.md: every migration that creates a table must grant service_role.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.clinician_corpus_documents TO service_role;
