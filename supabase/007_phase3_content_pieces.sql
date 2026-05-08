-- Phase 3: Interview fan-out into content_pieces.
-- Run this in your Supabase SQL Editor on EACH brand's Supabase instance
-- (people, equine, animals). Supabase Dashboard → SQL Editor → New Query.
--
-- Adds:
--   1. media_assets.parent_id  — links a "final" rendered asset (uploaded back
--      from the in-house editor) to its source interview row.
--   2. content_pieces table   — one row per AI-suggested post candidate
--      surfaced from an interview by Sonnet 4.6. The editor reviews,
--      accepts/edits, takes the accepted ones offline (CapCut etc.), uploads
--      the finished file back, and publishes (GBP / newsletter / download).

-- 1. Final-asset → source-interview link.
ALTER TABLE media_assets
  ADD COLUMN IF NOT EXISTS parent_id UUID REFERENCES media_assets(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS media_assets_parent_id_idx ON media_assets(parent_id);

-- 2. content_pieces — the editorial workbench primitive.
CREATE TABLE IF NOT EXISTS content_pieces (
  id                     UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  brand                  TEXT NOT NULL,                  -- 'people' | 'equine' | 'animals'
  source_asset_id        UUID NOT NULL REFERENCES media_assets(id) ON DELETE CASCADE,

  -- Slicing into the source interview. trim_start/end are best-effort estimates
  -- from Sonnet (may be NULL for v1 — editor leans on source_quote to find the
  -- moment in CapCut). source_quote is verbatim from the transcript.
  source_trim_start      NUMERIC,                        -- seconds
  source_trim_end        NUMERIC,
  source_quote           TEXT,

  -- AI editorial seed (Sonnet output)
  ai_suggested_platform  TEXT,                           -- reels | feed | story | shorts | tiktok | gbp | newsletter
  ai_caption             TEXT,
  ai_hashtags            JSONB NOT NULL DEFAULT '[]',
  ai_cta_text            TEXT,
  ai_reasoning           TEXT,                           -- 1 sentence: why this moment
  ai_model               TEXT,
  ai_generated_at        TIMESTAMPTZ,

  -- Editor's final (start as copies of AI fields; editable in the queue UI)
  final_caption          TEXT,
  final_hashtags         JSONB,
  final_cta_text         TEXT,
  final_cta_url          TEXT,
  target_platform        TEXT,
  final_asset_id         UUID REFERENCES media_assets(id) ON DELETE SET NULL,

  -- Workflow
  status                 TEXT NOT NULL DEFAULT 'suggested',
  -- suggested | accepted | rejected | in_progress | returned | published | archived
  assigned_to            TEXT,                            -- email
  notes                  TEXT,
  rejected_reason        TEXT,

  -- Timestamps
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  accepted_at            TIMESTAMPTZ,
  returned_at            TIMESTAMPTZ,
  published_at           TIMESTAMPTZ,
  published_target_id    TEXT                             -- GBP post id, TDC campaign id, etc.
);

CREATE INDEX IF NOT EXISTS content_pieces_brand_status_idx ON content_pieces(brand, status);
CREATE INDEX IF NOT EXISTS content_pieces_source_idx       ON content_pieces(source_asset_id);
CREATE INDEX IF NOT EXISTS content_pieces_created_at_idx   ON content_pieces(created_at DESC);
CREATE INDEX IF NOT EXISTS content_pieces_assigned_idx     ON content_pieces(assigned_to)
  WHERE status IN ('accepted','in_progress');

-- Reuse the updated_at trigger function from 001_content_items.sql.
DROP TRIGGER IF EXISTS update_content_pieces_updated_at ON content_pieces;
CREATE TRIGGER update_content_pieces_updated_at
  BEFORE UPDATE ON content_pieces
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
