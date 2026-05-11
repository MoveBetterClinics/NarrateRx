-- Add alt_text to media_assets.
--
-- First-class accessibility metadata + publishing-quality field. Was missing
-- from the schema; MediaGrid was falling back to filename for the <img alt=>
-- attribute, which is useless to screen readers and not what we want pasted
-- into social captions.
--
-- Free-form text capped at 250 chars at the UI level (no DB constraint —
-- keeps future copy expansion painless). NULL = "no alt text set yet";
-- consumers should fall back to filename in that case.
--
-- Per CLAUDE.md: every new column on a domain table needs an explicit grant.
-- media_assets already has full service_role grants from earlier migrations,
-- but adding the column on its own doesn't change that; this migration is
-- additive and safe to re-run on environments that already applied it
-- (IF NOT EXISTS).

alter table public.media_assets
  add column if not exists alt_text text;

-- No grant needed: media_assets-level grants cascade to new columns.
