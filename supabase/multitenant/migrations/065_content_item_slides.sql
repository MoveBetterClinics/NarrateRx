-- Per-slide freeform text-block model for Instagram (and future) on-photo text.
--
-- Today: content_items.overlay_text JSONB = { hook, subhead, cta } applied
-- globally to every attached photo. The renderer (src/lib/overlayTemplates.js)
-- picks a template per slide and bakes one of those three fields onto it.
--
-- Going forward: content_items.slides JSONB = [
--   {
--     photo_idx: 0 | null,           -- index into media_urls; null = unbound
--     template: 'cover' | 'explainer' | 'demonstration' | 'quote' | 'cta' | 'custom',
--     blocks: [
--       { role: 'hook' | 'body' | 'caption' | 'cta' | 'attribution' | 'page',
--         text: string,
--         position: 'top-left' | 'top' | 'top-right' | 'center-left' | 'center'
--                 | 'center-right' | 'bottom-left' | 'bottom' | 'bottom-right'
--                 | { x: 0..1, y: 0..1 } },
--       ...
--     ]
--   },
--   ...
-- ]
--
-- overlay_text stays in place (read-only, vestigial) so any unmigrated row
-- or accidental legacy reader still resolves. Drop in a follow-up after a
-- few weeks of clean writes.

ALTER TABLE public.content_items
  ADD COLUMN IF NOT EXISTS slides jsonb DEFAULT NULL;

-- Backfill: for every Instagram piece with overlay_text, synthesize a slides
-- array. Carousel convention historically was slot-0 = hook, slot-1 = subhead,
-- slot-2 = cta — we keep that mapping. Empty overlay fields produce no slide.
UPDATE public.content_items
SET slides = (
  SELECT jsonb_agg(s ORDER BY ord)
  FROM (
    SELECT 1 AS ord,
           jsonb_build_object(
             'photo_idx',
               CASE WHEN jsonb_array_length(COALESCE(media_urls, '[]'::jsonb)) > 0
                    THEN 0::int END,
             'template', 'cover',
             'blocks', jsonb_build_array(
               jsonb_build_object(
                 'role',     'hook',
                 'text',     overlay_text->>'hook',
                 'position', 'center'
               )
             )
           ) AS s
    WHERE COALESCE(overlay_text->>'hook', '') <> ''

    UNION ALL

    SELECT 2,
           jsonb_build_object(
             'photo_idx',
               CASE WHEN jsonb_array_length(COALESCE(media_urls, '[]'::jsonb)) > 1
                    THEN 1::int END,
             'template', 'explainer',
             'blocks', jsonb_build_array(
               jsonb_build_object(
                 'role',     'body',
                 'text',     overlay_text->>'subhead',
                 'position', 'center'
               )
             )
           )
    WHERE COALESCE(overlay_text->>'subhead', '') <> ''

    UNION ALL

    SELECT 3,
           jsonb_build_object(
             'photo_idx',
               CASE WHEN jsonb_array_length(COALESCE(media_urls, '[]'::jsonb)) > 2
                    THEN 2::int END,
             'template', 'cta',
             'blocks', jsonb_build_array(
               jsonb_build_object(
                 'role',     'cta',
                 'text',     overlay_text->>'cta',
                 'position', 'bottom'
               )
             )
           )
    WHERE COALESCE(overlay_text->>'cta', '') <> ''
  ) AS x
)
WHERE platform = 'instagram'
  AND overlay_text IS NOT NULL
  AND slides IS NULL;

-- Tenant grants — every new column on a tenant-scoped table needs explicit
-- service_role rights (the REST API used by serverless runs as service_role
-- and returns 42501/403 on unprivileged columns).
GRANT SELECT, INSERT, UPDATE ON public.content_items TO service_role;
