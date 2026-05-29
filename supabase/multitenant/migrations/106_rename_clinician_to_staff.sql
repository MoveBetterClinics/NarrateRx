-- 106_rename_clinician_to_staff.sql
-- Phase 2/3 of the clinician → staff full rename (Option C). Coordinated flip.
--
-- Renames the "clinician" ROSTER ENTITY to "staff":
--   tables clinicians / clinician_recipes / clinician_voice_phrases / clinician_corpus_documents
--   13 clinician_id FK columns (incl. video_segments) + content_items.clinician_name + campaigns.target_clinician_ids
--   all clinician-named constraints/indexes; recreates 2 RPCs that reference the column.
--
-- KEEPS "clinician" as a permission ROLE/classification VALUE (owner decision):
--   permission_tier 'clinician', staff_type 'clinician'/'non_clinical_staff', speaker_role 'clinician'.
--   Only object NAMES change; CHECK/role VALUES are untouched.
--
-- Adds backward-compat VIEWS over the 4 renamed tables so .from('clinicians') etc.
-- keep working through the code-deploy burst. (Dropped in 107.)
--
-- ALTER INDEX statements use IF EXISTS so the pkey-backed index renames are
-- idempotent whether or not RENAME CONSTRAINT already renamed the backing index.
--
-- Self-sufficient grants per CLAUDE.md (REST runs as service_role).

BEGIN;

-- ── 1) Core tables ──────────────────────────────────────────────────────────
ALTER TABLE public.clinicians                 RENAME TO staff;
ALTER TABLE public.clinician_recipes          RENAME TO staff_recipes;
ALTER TABLE public.clinician_voice_phrases    RENAME TO staff_voice_phrases;
ALTER TABLE public.clinician_corpus_documents RENAME TO staff_corpus_documents;

-- ── 2) FK columns clinician_id -> staff_id (13 tables) + clinician_name + array ─
ALTER TABLE public.staff_recipes                   RENAME COLUMN clinician_id TO staff_id;
ALTER TABLE public.staff_voice_phrases             RENAME COLUMN clinician_id TO staff_id;
ALTER TABLE public.staff_corpus_documents          RENAME COLUMN clinician_id TO staff_id;
ALTER TABLE public.interviews                      RENAME COLUMN clinician_id TO staff_id;
ALTER TABLE public.content_items                   RENAME COLUMN clinician_id TO staff_id;
ALTER TABLE public.content_items                   RENAME COLUMN clinician_name TO staff_name;
ALTER TABLE public.media_assets                    RENAME COLUMN clinician_id TO staff_id;
ALTER TABLE public.concept_mentions                RENAME COLUMN clinician_id TO staff_id;
ALTER TABLE public.story_packages                  RENAME COLUMN clinician_id TO staff_id;
ALTER TABLE public.video_segments                  RENAME COLUMN clinician_id TO staff_id;
ALTER TABLE public.visual_memory_chunks            RENAME COLUMN clinician_id TO staff_id;
ALTER TABLE public.practice_memory_chunks          RENAME COLUMN clinician_id TO staff_id;
ALTER TABLE public.workspace_onboarding_interviews RENAME COLUMN clinician_id TO staff_id;
ALTER TABLE public.campaigns                       RENAME COLUMN target_clinician_ids TO target_staff_ids;

-- ── 3) FK constraint names ────────────────────────────────────────────────────
ALTER TABLE public.staff_recipes                   RENAME CONSTRAINT clinician_recipes_clinician_id_fkey          TO staff_recipes_staff_id_fkey;
ALTER TABLE public.staff_voice_phrases             RENAME CONSTRAINT clinician_voice_phrases_clinician_id_fkey    TO staff_voice_phrases_staff_id_fkey;
ALTER TABLE public.staff_corpus_documents          RENAME CONSTRAINT clinician_corpus_documents_clinician_id_fkey TO staff_corpus_documents_staff_id_fkey;
ALTER TABLE public.interviews                      RENAME CONSTRAINT interviews_clinician_id_fkey                 TO interviews_staff_id_fkey;
ALTER TABLE public.content_items                   RENAME CONSTRAINT content_items_clinician_id_fkey              TO content_items_staff_id_fkey;
ALTER TABLE public.media_assets                    RENAME CONSTRAINT media_assets_clinician_id_fkey               TO media_assets_staff_id_fkey;
ALTER TABLE public.concept_mentions                RENAME CONSTRAINT concept_mentions_clinician_id_fkey           TO concept_mentions_staff_id_fkey;
ALTER TABLE public.story_packages                  RENAME CONSTRAINT story_packages_clinician_id_fkey             TO story_packages_staff_id_fkey;
ALTER TABLE public.video_segments                  RENAME CONSTRAINT video_segments_clinician_id_fkey             TO video_segments_staff_id_fkey;
ALTER TABLE public.visual_memory_chunks            RENAME CONSTRAINT visual_memory_chunks_clinician_id_fkey       TO visual_memory_chunks_staff_id_fkey;
ALTER TABLE public.practice_memory_chunks          RENAME CONSTRAINT practice_memory_chunks_clinician_id_fkey     TO practice_memory_chunks_staff_id_fkey;
ALTER TABLE public.workspace_onboarding_interviews RENAME CONSTRAINT workspace_onboarding_interviews_clinician_id_fkey TO workspace_onboarding_interviews_staff_id_fkey;

-- ── 4) PK / workspace-FK / CHECK constraint names on the 4 renamed tables ─────
--     (CHECK *values* 'clinician'/'non_clinical_staff' are KEPT — only names change)
ALTER TABLE public.staff                  RENAME CONSTRAINT clinicians_pkey                            TO staff_pkey;
ALTER TABLE public.staff                  RENAME CONSTRAINT clinicians_workspace_id_fkey               TO staff_workspace_id_fkey;
ALTER TABLE public.staff                  RENAME CONSTRAINT clinicians_permission_tier_check           TO staff_permission_tier_check;
ALTER TABLE public.staff                  RENAME CONSTRAINT clinicians_staff_type_check                TO staff_staff_type_check;
ALTER TABLE public.staff_recipes          RENAME CONSTRAINT clinician_recipes_pkey                     TO staff_recipes_pkey;
ALTER TABLE public.staff_recipes          RENAME CONSTRAINT clinician_recipes_workspace_id_fkey        TO staff_recipes_workspace_id_fkey;
ALTER TABLE public.staff_voice_phrases    RENAME CONSTRAINT clinician_voice_phrases_pkey               TO staff_voice_phrases_pkey;
ALTER TABLE public.staff_voice_phrases    RENAME CONSTRAINT clinician_voice_phrases_workspace_id_fkey  TO staff_voice_phrases_workspace_id_fkey;
ALTER TABLE public.staff_corpus_documents RENAME CONSTRAINT clinician_corpus_documents_pkey            TO staff_corpus_documents_pkey;
ALTER TABLE public.staff_corpus_documents RENAME CONSTRAINT clinician_corpus_documents_workspace_id_fkey TO staff_corpus_documents_workspace_id_fkey;

-- ── 5) Index names (defs auto-track renamed columns) ──────────────────────────
-- 5a) constraint-backed (pkey) indexes — idempotent via IF EXISTS
ALTER INDEX IF EXISTS public.clinicians_pkey                 RENAME TO staff_pkey;
ALTER INDEX IF EXISTS public.clinician_recipes_pkey          RENAME TO staff_recipes_pkey;
ALTER INDEX IF EXISTS public.clinician_voice_phrases_pkey    RENAME TO staff_voice_phrases_pkey;
ALTER INDEX IF EXISTS public.clinician_corpus_documents_pkey RENAME TO staff_corpus_documents_pkey;
-- 5b) standalone indexes
ALTER INDEX IF EXISTS public.clinicians_active_voice_clone_idx     RENAME TO staff_active_voice_clone_idx;
ALTER INDEX IF EXISTS public.clinicians_capture_upload_token_uniq  RENAME TO staff_capture_upload_token_uniq;
ALTER INDEX IF EXISTS public.clinicians_workspace_creator_idx      RENAME TO staff_workspace_creator_idx;
ALTER INDEX IF EXISTS public.clinicians_workspace_idx              RENAME TO staff_workspace_idx;
ALTER INDEX IF EXISTS public.clinicians_workspace_name_idx         RENAME TO staff_workspace_name_idx;
ALTER INDEX IF EXISTS public.clinicians_workspace_user_idx         RENAME TO staff_workspace_user_idx;
ALTER INDEX IF EXISTS public.clinician_corpus_docs_title_uniq_idx  RENAME TO staff_corpus_docs_title_uniq_idx;
ALTER INDEX IF EXISTS public.clinician_recipes_clinician_idx       RENAME TO staff_recipes_staff_idx;
ALTER INDEX IF EXISTS public.clinician_recipes_one_default_idx     RENAME TO staff_recipes_one_default_idx;
ALTER INDEX IF EXISTS public.clinician_voice_phrases_lookup_idx    RENAME TO staff_voice_phrases_lookup_idx;
ALTER INDEX IF EXISTS public.clinician_voice_phrases_uniq_idx      RENAME TO staff_voice_phrases_uniq_idx;
ALTER INDEX IF EXISTS public.clinician_voice_phrases_workspace_idx RENAME TO staff_voice_phrases_workspace_idx;
ALTER INDEX IF EXISTS public.concept_mentions_clinician            RENAME TO concept_mentions_staff;
ALTER INDEX IF EXISTS public.idx_story_packages_clinician_id       RENAME TO idx_story_packages_staff_id;
ALTER INDEX IF EXISTS public.interviews_workspace_clinician_idx    RENAME TO interviews_workspace_staff_idx;
ALTER INDEX IF EXISTS public.media_assets_clinician_idx            RENAME TO media_assets_staff_idx;
ALTER INDEX IF EXISTS public.visual_memory_chunks_clinician_idx    RENAME TO visual_memory_chunks_staff_idx;

-- ── 6) book_excluded_sources CHECK stores the old table name as a value ───────
ALTER TABLE public.book_excluded_sources DROP CONSTRAINT book_excluded_sources_table_check;
UPDATE public.book_excluded_sources SET source_table='staff_corpus_documents' WHERE source_table='clinician_corpus_documents';
ALTER TABLE public.book_excluded_sources
  ADD CONSTRAINT book_excluded_sources_table_check
  CHECK (source_table = ANY (ARRAY['interviews'::text, 'staff_corpus_documents'::text]));

-- ── 7) Recreate RPCs (param + column refs). DROP+CREATE: param names change. ───
DROP FUNCTION IF EXISTS public.match_practice_memory_chunks(uuid, uuid, vector, integer, uuid[], text[]);
CREATE FUNCTION public.match_practice_memory_chunks(
  p_workspace_id uuid, p_staff_id uuid, p_query_embedding vector,
  p_match_count integer DEFAULT 6, p_exclude_source_ids uuid[] DEFAULT '{}'::uuid[],
  p_source_types text[] DEFAULT NULL::text[])
RETURNS TABLE(id uuid, source_type text, source_id uuid, source_label text, text text, similarity double precision)
LANGUAGE sql STABLE AS $function$
  SELECT c.id, c.source_type, c.source_id, c.source_label, c.text,
         1 - (c.embedding <=> p_query_embedding) AS similarity
  FROM public.practice_memory_chunks c
  WHERE c.workspace_id = p_workspace_id
    AND (p_staff_id IS NULL OR c.staff_id = p_staff_id)
    AND (p_source_types IS NULL OR c.source_type = ANY (p_source_types))
    AND c.embedding IS NOT NULL
    AND NOT (c.source_id = ANY (COALESCE(p_exclude_source_ids, '{}'::uuid[])))
  ORDER BY c.embedding <=> p_query_embedding
  LIMIT GREATEST(p_match_count, 1);
$function$;

DROP FUNCTION IF EXISTS public.match_visual_memory_chunks(vector, integer, uuid, text, real, uuid);
CREATE FUNCTION public.match_visual_memory_chunks(
  query_embedding vector, match_count integer DEFAULT 8, filter_workspace_id uuid DEFAULT NULL::uuid,
  filter_kind text DEFAULT NULL::text, filter_min_score real DEFAULT 0.0, filter_staff_id uuid DEFAULT NULL::uuid)
RETURNS TABLE(chunk_id uuid, workspace_id uuid, staff_id uuid, source_type text, source_id uuid,
  source_blob_url text, chunk_tags jsonb, audio_quality real, video_quality real, story_role text,
  similarity real, asset_kind text, asset_blob_url text, asset_thumbnail_url text, asset_filename text,
  asset_duration_s numeric, asset_aspect_ratio text, asset_visual_narrative text, asset_ai_tags jsonb,
  asset_captured_at timestamp with time zone)
LANGUAGE sql STABLE AS $function$
  SELECT v.id AS chunk_id, v.workspace_id, v.staff_id, v.source_type, v.source_id, v.source_blob_url,
    v.tags AS chunk_tags, v.audio_quality, v.video_quality, v.story_role,
    (1 - (v.embedding <=> query_embedding))::real AS similarity,
    m.kind AS asset_kind, m.blob_url AS asset_blob_url, m.thumbnail_url AS asset_thumbnail_url,
    m.filename AS asset_filename, m.duration_s AS asset_duration_s, m.aspect_ratio AS asset_aspect_ratio,
    m.visual_narrative AS asset_visual_narrative, m.ai_tags AS asset_ai_tags, m.captured_at AS asset_captured_at
  FROM public.visual_memory_chunks v
  LEFT JOIN public.media_assets m ON m.id = v.source_id AND v.source_type = 'media_asset' AND m.archived_at IS NULL
  WHERE v.embedding IS NOT NULL
    AND (filter_workspace_id IS NULL OR v.workspace_id = filter_workspace_id)
    AND (filter_kind IS NULL OR m.kind = filter_kind)
    AND (filter_staff_id IS NULL OR v.staff_id = filter_staff_id)
    AND (1 - (v.embedding <=> query_embedding))::real >= filter_min_score
  ORDER BY v.embedding <=> query_embedding
  LIMIT match_count;
$function$;
-- callers flip in lockstep: api/_lib/practiceMemoryRag.js (p_staff_id), api/_lib/clipSearch.js (filter_staff_id + reads .staff_id)

-- ── 8) Backward-compat VIEWS (simple, updatable; preserve .from('clinicians')) ─
-- NOTE: views expose staff_id (renamed col), NOT clinician_id. They preserve the
-- TABLE name only. Column-level clinician_id refs in not-yet-deployed code break
-- during the ~2-min cutover window (accepted per coordinated-flip). Dropped in 107.
CREATE VIEW public.clinicians                 AS SELECT * FROM public.staff;
CREATE VIEW public.clinician_recipes          AS SELECT * FROM public.staff_recipes;
CREATE VIEW public.clinician_voice_phrases    AS SELECT * FROM public.staff_voice_phrases;
CREATE VIEW public.clinician_corpus_documents AS SELECT * FROM public.staff_corpus_documents;

-- ── 9) Grants (service_role) ──────────────────────────────────────────────────
GRANT SELECT, INSERT, UPDATE, DELETE ON public.staff, public.staff_recipes, public.staff_voice_phrases, public.staff_corpus_documents TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.clinicians, public.clinician_recipes, public.clinician_voice_phrases, public.clinician_corpus_documents TO service_role;
GRANT EXECUTE ON FUNCTION public.match_practice_memory_chunks(uuid, uuid, vector, integer, uuid[], text[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.match_visual_memory_chunks(vector, integer, uuid, text, real, uuid) TO service_role;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO service_role;

COMMIT;
