-- Add asset_purpose to media_assets + make speaker_role nullable.
--
-- Background: the Media Hub originally assumed every upload was an interview
-- clip (clinician/admin/patient_guest). In reality a clinic's library is
-- mostly diverse: B-roll of treatment in progress, photos of the facility,
-- team headshots, equipment, signage, brand assets. Forcing those uploads
-- through a "Who's speaking?" gate was wrong and over-processed them
-- (running interview-segmenter prompts on a clinic photo is nonsense and
-- still costs an AI call).
--
-- This migration introduces an asset_purpose dimension and decouples
-- speaker_role from "every asset has one":
--
--   asset_purpose:
--     interview   — someone speaking on camera (the original flow)
--     broll       — video of treatment / interaction / atmosphere, no narrative
--     photo       — clinic, team, equipment, before/after, social
--     brand       — logos, headshots, graphics (also surfaced in Brand Kit)
--
--   speaker_role becomes NULLABLE — only set when asset_purpose='interview'.
--
-- Backfill: every existing row predates the split and was treated as an
-- interview. Map kind→purpose so the data stays self-consistent:
--   kind='video' → 'interview' (preserves the speaker_role they already carry)
--   kind='photo' → 'photo'     (clears speaker_role since it never applied)
--
-- Per CLAUDE.md: media_assets-level grants cascade to new columns, so no
-- additional GRANT is required. Safe to re-run (IF NOT EXISTS / WHERE).

alter table public.media_assets
  add column if not exists asset_purpose text;

-- Backfill before adding the NOT NULL + CHECK so existing rows pass the check.
update public.media_assets
  set asset_purpose = case
    when kind = 'video' then 'interview'
    when kind = 'photo' then 'photo'
    else 'photo'
  end
  where asset_purpose is null;

-- Clear speaker_role on rows that aren't interviews — they never represented
-- a real speaker, just the schema default. Keeping them populated would muddy
-- the new filter UI and continue feeding misleading data into the AI
-- pipeline if anyone re-ran tagging.
update public.media_assets
  set speaker_role = null
  where asset_purpose <> 'interview';

alter table public.media_assets
  alter column asset_purpose set not null;

alter table public.media_assets
  drop constraint if exists media_assets_asset_purpose_check;
alter table public.media_assets
  add constraint media_assets_asset_purpose_check
    check (asset_purpose in ('interview', 'broll', 'photo', 'brand'));

-- speaker_role was NOT NULL with default 'clinician'. Drop both — the value
-- is only meaningful for interview-purpose rows now, and the default would
-- silently re-pollute non-interview uploads if any code path neglected to
-- pass null.
alter table public.media_assets
  alter column speaker_role drop not null;
alter table public.media_assets
  alter column speaker_role drop default;

-- Index the new column — both the Media Hub filter and the segmenter eligibility
-- check filter on it. Partial workspace-scoped indexes already exist for the
-- common (workspace_id, status) reads; a plain btree here is enough since
-- queries combine with the workspace_id predicate at runtime.
create index if not exists idx_media_assets_asset_purpose
  on public.media_assets (asset_purpose);
