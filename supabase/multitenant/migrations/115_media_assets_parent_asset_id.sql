-- 115: add parent_asset_id to media_assets for clip provenance tracking
-- Records which source video a Slate-cut clip was derived from.
-- Used by the Slate workshop to show "X clips cut" per source video.

ALTER TABLE public.media_assets
  ADD COLUMN IF NOT EXISTS parent_asset_id uuid
    REFERENCES public.media_assets(id) ON DELETE SET NULL;

-- Grants are inherited from the table but be explicit per project convention.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.media_assets TO service_role;
