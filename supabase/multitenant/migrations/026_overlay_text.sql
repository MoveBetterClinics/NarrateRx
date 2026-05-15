-- Add overlay_text column to content_items for Instagram image overlay data.
-- Stores AI-generated { hook, subhead, cta } so it persists separately from
-- the caption and can be edited independently in ReviewPost.
ALTER TABLE public.content_items
  ADD COLUMN IF NOT EXISTS overlay_text jsonb DEFAULT NULL;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.content_items TO service_role;
