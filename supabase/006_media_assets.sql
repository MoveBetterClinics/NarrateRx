-- Run this in your Supabase SQL Editor
-- Supabase Dashboard → SQL Editor → New Query → paste → Run
--
-- Run on EACH brand's Supabase instance (people, equine, animals).

CREATE TABLE IF NOT EXISTS media_assets (
  id                UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  brand             TEXT NOT NULL,                -- 'people' | 'equine' | 'animals'
  kind              TEXT NOT NULL,                -- 'video' | 'photo'
  status            TEXT NOT NULL DEFAULT 'raw',  -- raw | tagged | rendered | approved | archived
  source            TEXT NOT NULL DEFAULT 'upload', -- upload | drive
  blob_url          TEXT,                         -- Vercel Blob URL for the raw file
  blob_pathname     TEXT,                         -- pathname inside the blob store (for deletes)
  rendered_url      TEXT,                         -- branded output (Phase 3)
  drive_id          TEXT,                         -- optional, for Drive-sourced assets
  filename          TEXT,
  mime_type         TEXT,
  size_bytes        BIGINT,
  duration_s        NUMERIC,                      -- video only
  aspect_ratio      TEXT,                         -- '9:16' | '16:9' | '1:1' | '4:5'
  width             INTEGER,
  height            INTEGER,
  thumbnail_url     TEXT,                         -- poster frame for video, scaled for photo
  patient_pseudonym TEXT,
  condition         TEXT,
  captured_at       TIMESTAMPTZ,
  tags              JSONB NOT NULL DEFAULT '[]',  -- user-applied tags
  ai_tags           JSONB NOT NULL DEFAULT '[]',  -- AI-suggested (Phase 2)
  transcription     TEXT,                          -- Phase 2
  notes             TEXT,
  content_item_ids  JSONB NOT NULL DEFAULT '[]',  -- back-refs to posts that used this asset
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by        TEXT                           -- Clerk user id
);

CREATE INDEX IF NOT EXISTS media_assets_brand_idx       ON media_assets(brand);
CREATE INDEX IF NOT EXISTS media_assets_status_idx      ON media_assets(status);
CREATE INDEX IF NOT EXISTS media_assets_kind_idx        ON media_assets(kind);
CREATE INDEX IF NOT EXISTS media_assets_created_at_idx  ON media_assets(created_at DESC);
CREATE INDEX IF NOT EXISTS media_assets_captured_at_idx ON media_assets(captured_at DESC);

-- Reuse the trigger function defined in 001_content_items.sql
DROP TRIGGER IF EXISTS update_media_assets_updated_at ON media_assets;
CREATE TRIGGER update_media_assets_updated_at
  BEFORE UPDATE ON media_assets
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
