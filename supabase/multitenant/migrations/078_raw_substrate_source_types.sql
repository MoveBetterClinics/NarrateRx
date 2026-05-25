-- Phase 5+ — raw-substrate source types for Author Mode (Q's book).
--
-- Migration 073's CHECK constraint admits three source_types, all
-- AI-derived/synthesized:
--   interview_summary  — model summary of an interview
--   content_item       — paragraph-chunks of approved/published GENERATED content
--   voice_phrase       — extracted clinician phrases
--
-- Project A (Practice Mode, Move Better Clinic) reads over the synthesized
-- corpus — that's the right substrate for a patient-facing chat widget and a
-- group-voice practice wikipedia.
--
-- Project B (Author Mode, Q's personal book) MUST NOT retrieve over
-- AI-generated text. The whole point is to surface the clinician's own raw
-- words and let them compose. So this migration adds three new source_types
-- the indexer + retrieval can carry, all guaranteed to be the clinician's
-- own voice:
--
--   interview_transcript_full — paragraph-chunks of interviews.cleaned_messages
--                               (raw spoken words from the interview channel,
--                               not the AI summary)
--   original_blog             — blog posts the clinician typed themselves
--                               pre-NarrateRx, ingested via /api/corpus/ingest
--   uploaded_draft            — arbitrary draft documents (notes, voice memos
--                               transcribed verbatim, longhand drafts) ingested
--                               via /api/corpus/ingest
--
-- The retrieval RPC gains an optional p_source_types text[] filter so
-- callers can scope to either set. Old 5-arg signature is dropped because
-- the new signature is a superset; PostgREST named-arg calls remain
-- compatible because p_source_types defaults to NULL (= all types).

-- 1. Expand the CHECK constraint.
ALTER TABLE public.practice_memory_chunks
  DROP CONSTRAINT IF EXISTS practice_memory_chunks_source_type_check;

ALTER TABLE public.practice_memory_chunks
  ADD CONSTRAINT practice_memory_chunks_source_type_check
  CHECK (source_type IN (
    'interview_summary',
    'content_item',
    'voice_phrase',
    'interview_transcript_full',
    'original_blog',
    'uploaded_draft'
  ));

-- 2. Drop the old 5-arg retrieval RPC.
--
-- We replace it with a 6-arg variant; keeping both would create overload
-- ambiguity for PostgREST when callers supply only the 5 original args.
DROP FUNCTION IF EXISTS public.match_practice_memory_chunks(uuid, uuid, vector, int, uuid[]);

-- 3. Recreate the retrieval RPC with an optional source_types filter.
--
-- p_source_types = NULL    → return chunks of every source_type (Practice Mode default)
-- p_source_types = ARRAY[...] → return only chunks whose source_type is in the array
--
-- Author Mode passes the raw-substrate triple:
--   ARRAY['interview_transcript_full','original_blog','uploaded_draft']
CREATE OR REPLACE FUNCTION public.match_practice_memory_chunks(
  p_workspace_id        uuid,
  p_clinician_id        uuid,
  p_query_embedding     vector(1536),
  p_match_count         int      DEFAULT 6,
  p_exclude_source_ids  uuid[]   DEFAULT '{}'::uuid[],
  p_source_types        text[]   DEFAULT NULL
)
RETURNS TABLE (
  id            uuid,
  source_type   text,
  source_id     uuid,
  source_label  text,
  text          text,
  similarity    float
)
LANGUAGE sql STABLE AS $$
  SELECT
    c.id,
    c.source_type,
    c.source_id,
    c.source_label,
    c.text,
    1 - (c.embedding <=> p_query_embedding) AS similarity
  FROM public.practice_memory_chunks c
  WHERE c.workspace_id = p_workspace_id
    AND (p_clinician_id IS NULL OR c.clinician_id = p_clinician_id)
    AND (p_source_types IS NULL OR c.source_type = ANY (p_source_types))
    AND c.embedding IS NOT NULL
    AND NOT (c.source_id = ANY (COALESCE(p_exclude_source_ids, '{}'::uuid[])))
  ORDER BY c.embedding <=> p_query_embedding
  LIMIT GREATEST(p_match_count, 1);
$$;

GRANT EXECUTE ON FUNCTION public.match_practice_memory_chunks(uuid, uuid, vector, int, uuid[], text[]) TO service_role;
