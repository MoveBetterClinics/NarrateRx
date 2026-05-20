-- 057_media_web_variants.sql
--
-- Hybrid storage for the Media Library (publishing-pool decision, 2026-05-20).
-- Every image upload now keeps both the original AND a resized "web variant".
-- Public surfaces (blog, social previews, /api/media list) serve the web
-- variant via `blob_url`; the original is preserved in `original_blob_url` for
-- re-derivation, recovery, or download.
--
--   original_blob_url TEXT  — Vercel Blob URL of the file as uploaded by the
--                             user. NULL on legacy rows uploaded before this
--                             migration (in which case `blob_url` IS the
--                             original).
--   web_blob_url      TEXT  — Vercel Blob URL of the resized / re-encoded
--                             variant served on the web. Mirrored into
--                             `blob_url` so existing consumers keep working
--                             without per-call-site changes. NULL while the
--                             post-upload pipeline is still running and on
--                             legacy rows.
--   web_width         INT   — Pixel width of the web variant. May differ from
--                             the existing `width` column if the original was
--                             larger than the resize ceiling.
--   web_height        INT   — Pixel height of the web variant.
--
-- `alt_text` is intentionally NOT added here — it was added by migration 019.
-- The post-upload pipeline writes AI-generated alt text into the existing
-- column.
--
-- Backward compat invariant: code reading `blob_url` does not need to know
-- whether the row has a web variant. New uploads set `blob_url = web_blob_url`
-- once the pipeline lands; old uploads (no pipeline ever ran) keep `blob_url`
-- pointing at the original, which renders fine for the formats they were
-- uploaded in (JPEG / PNG / MP4). HEIC was rejected at the handshake before
-- this migration, so no legacy row has an un-renderable canonical blob.

alter table public.media_assets
  add column if not exists original_blob_url text,
  add column if not exists web_blob_url      text,
  add column if not exists web_width         integer,
  add column if not exists web_height        integer;

-- media_assets already has full service_role grants from migration 003.
-- ALTER TABLE preserves existing grants — new columns inherit them. This
-- migration is additive and safe to re-run.
