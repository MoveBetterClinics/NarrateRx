-- 040_media_variants.sql
--
-- Edit Media feature: derive variants from a source asset via rotate + crop.
-- The existing `parent_id` column already tracks derivative lineage (used by
-- the CapCut return-upload flow). This migration adds two columns so a
-- variant row can describe itself:
--
--   variant_label TEXT   — human-readable label, e.g. "9:16 Reel", "1:1 Square".
--                          NULL on source assets and on legacy non-variant
--                          children (e.g. returned edits from CapCut).
--   transforms    JSONB  — the transforms that produced this variant from its
--                          parent: { rotate: 90, crop: { x, y, w, h } }. Stored
--                          so we can re-derive variants later if encoding tech
--                          improves without losing the user's intent.
--
-- No backfill — existing rows stay NULL on both columns. The library/UI gates
-- "variant" affordances on `parent_id IS NOT NULL AND variant_label IS NOT NULL`
-- so pre-existing parent-linked rows (CapCut returns) are not retroactively
-- treated as variants.

ALTER TABLE public.media_assets
  ADD COLUMN IF NOT EXISTS variant_label TEXT NULL,
  ADD COLUMN IF NOT EXISTS transforms    JSONB NULL;

-- Index for the common variant lookup: "show me all variants of this source".
-- parent_id already has a btree index from migration 020-ish; this partial
-- index narrows the variant case so the variant strip in MediaDetail is fast
-- even as the library grows.
CREATE INDEX IF NOT EXISTS media_assets_variants_idx
  ON public.media_assets (parent_id)
  WHERE variant_label IS NOT NULL;

-- service_role already has SELECT/INSERT/UPDATE/DELETE on media_assets from
-- migration 003; ALTER TABLE preserves those grants. No additional grants
-- needed for the new columns.
