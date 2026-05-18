-- Per-location GBP post body overrides.
-- Shape: { "<location_uuid>": { "content": "...", "location_name": "...", "generated_at": "..." } }
-- Null for all non-GBP platforms and single-location workspaces (canonical body suffices).
ALTER TABLE public.content_items
  ADD COLUMN IF NOT EXISTS location_overrides jsonb;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.content_items TO service_role;
