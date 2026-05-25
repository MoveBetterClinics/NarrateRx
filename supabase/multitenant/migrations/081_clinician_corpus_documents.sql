-- Author Mode — clinician corpus documents table.
--
-- Stores drafts, uploaded documents, and other source material that
-- the clinician authors or imports for book/long-form writing work.
-- Rows are also indexed into practice_memory_chunks (source_type='uploaded_draft')
-- so the semantic sidebar can surface them alongside interview transcripts
-- and approved blog posts.
--
-- doc_type values:
--   uploaded_draft   — clinician-authored drafts saved via the Author Mode editor
--   (reserved for future: original_blog, transcript_full)

CREATE TABLE IF NOT EXISTS public.clinician_corpus_documents (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  clinician_id  uuid NOT NULL REFERENCES public.clinicians(id) ON DELETE CASCADE,
  doc_type      text NOT NULL DEFAULT 'uploaded_draft'
                  CHECK (doc_type IN ('uploaded_draft', 'original_blog', 'interview_transcript_full')),
  title         text NOT NULL DEFAULT '',
  body          text NOT NULL DEFAULT '',
  archived_at   timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- Unique draft title per clinician — enables idempotent upsert from the editor.
CREATE UNIQUE INDEX IF NOT EXISTS clinician_corpus_docs_title_uniq_idx
  ON public.clinician_corpus_documents (workspace_id, clinician_id, doc_type, title)
  WHERE archived_at IS NULL;

CREATE INDEX IF NOT EXISTS clinician_corpus_docs_scope_idx
  ON public.clinician_corpus_documents (workspace_id, clinician_id, doc_type, archived_at);

CREATE OR REPLACE FUNCTION public.clinician_corpus_documents_touch_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS clinician_corpus_documents_touch_updated_at ON public.clinician_corpus_documents;
CREATE TRIGGER clinician_corpus_documents_touch_updated_at
  BEFORE UPDATE ON public.clinician_corpus_documents
  FOR EACH ROW EXECUTE FUNCTION public.clinician_corpus_documents_touch_updated_at();

-- Also widen the source_type CHECK on practice_memory_chunks to allow
-- 'uploaded_draft' so indexed corpus docs can be retrieved by the RAG sidebar.
ALTER TABLE public.practice_memory_chunks
  DROP CONSTRAINT IF EXISTS practice_memory_chunks_source_type_check;

ALTER TABLE public.practice_memory_chunks
  ADD CONSTRAINT practice_memory_chunks_source_type_check
  CHECK (source_type IN ('interview_summary', 'content_item', 'voice_phrase', 'uploaded_draft'));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.clinician_corpus_documents TO service_role;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO service_role;
GRANT EXECUTE ON FUNCTION public.clinician_corpus_documents_touch_updated_at() TO service_role;
