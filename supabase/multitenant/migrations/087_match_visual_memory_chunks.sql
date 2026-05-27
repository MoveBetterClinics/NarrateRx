-- 087_match_visual_memory_chunks.sql
-- pgvector cosine-similarity RPC function for clip retrieval.
-- Phase 2 Day 6 of the 30-day video output build (2026-05-27).
--
-- Mirrors the pattern from migration 074 (match_practice_memory_chunks):
-- PostgREST can't express the `embedding <=> query` operator directly,
-- so we wrap it in a SQL function callable via RPC.
--
-- Returns visual_memory_chunks rows joined to media_assets so the caller
-- gets blob URLs + kind + duration in one query.

CREATE OR REPLACE FUNCTION public.match_visual_memory_chunks(
  query_embedding vector(1536),
  match_count int DEFAULT 8,
  filter_workspace_id uuid DEFAULT NULL,
  filter_kind text DEFAULT NULL,           -- 'photo' | 'video' | NULL (any)
  filter_min_score real DEFAULT 0.0,       -- cosine similarity threshold (0-1)
  filter_clinician_id uuid DEFAULT NULL    -- scope to one clinician's captures
)
RETURNS TABLE (
  chunk_id uuid,
  workspace_id uuid,
  clinician_id uuid,
  source_type text,
  source_id uuid,
  source_blob_url text,
  chunk_tags jsonb,
  audio_quality real,
  video_quality real,
  story_role text,
  similarity real,
  asset_kind text,
  asset_blob_url text,
  asset_thumbnail_url text,
  asset_filename text,
  asset_duration_s numeric,
  asset_aspect_ratio text,
  asset_visual_narrative text,
  asset_ai_tags jsonb,
  asset_captured_at timestamptz
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    v.id              AS chunk_id,
    v.workspace_id,
    v.clinician_id,
    v.source_type,
    v.source_id,
    v.source_blob_url,
    v.tags            AS chunk_tags,
    v.audio_quality,
    v.video_quality,
    v.story_role,
    (1 - (v.embedding <=> query_embedding))::real AS similarity,
    m.kind            AS asset_kind,
    m.blob_url        AS asset_blob_url,
    m.thumbnail_url   AS asset_thumbnail_url,
    m.filename        AS asset_filename,
    m.duration_s      AS asset_duration_s,
    m.aspect_ratio    AS asset_aspect_ratio,
    m.visual_narrative AS asset_visual_narrative,
    m.ai_tags         AS asset_ai_tags,
    m.captured_at     AS asset_captured_at
  FROM public.visual_memory_chunks v
  LEFT JOIN public.media_assets m
    ON m.id = v.source_id
    AND v.source_type = 'media_asset'
    AND m.archived_at IS NULL
  WHERE v.embedding IS NOT NULL
    AND (filter_workspace_id IS NULL OR v.workspace_id = filter_workspace_id)
    AND (filter_kind IS NULL OR m.kind = filter_kind)
    AND (filter_clinician_id IS NULL OR v.clinician_id = filter_clinician_id)
    AND (1 - (v.embedding <=> query_embedding))::real >= filter_min_score
  ORDER BY v.embedding <=> query_embedding
  LIMIT match_count
$$;

GRANT EXECUTE ON FUNCTION public.match_visual_memory_chunks(vector, int, uuid, text, real, uuid)
  TO service_role;
