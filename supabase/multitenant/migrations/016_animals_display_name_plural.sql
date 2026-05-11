-- 016_animals_display_name_plural.sql
--
-- The animals brand was renamed "Move Better Animal Chiropractic" →
-- "Move Better Animals Chiropractic" (plural) in JS code earlier this
-- year (see project_animals_brand_rename.md memory). The DB row from
-- 002_seed_movebetter.sql was never reconciled — UI surfaces that read
-- display_name / app_name / sign_in_blurb from the DB still render the
-- singular form.
--
-- This migration aligns the DB to the canonical plural form across the
-- animals workspaces row and its TDC newsletter template config row.
-- Each UPDATE is defensive (matches on the known stale value) so re-runs
-- are no-ops and any field that's already been hand-corrected stays
-- as-is.
--
-- Singular "Move Better Animal" survives in two contexts that are NOT
-- updated here:
--   - Historical seed migration 002_seed_movebetter.sql (immutable
--     history — never edit applied migrations).
--   - The Instagram/Facebook social handle '@movebetteranimal' on
--     workspaces.social — that's a handle, owned externally, unchanged
--     until the social accounts themselves are renamed.

begin;

update workspaces
set
  display_name   = 'Move Better Animals Chiropractic',
  app_name       = 'Move Better Animals Chiropractic — NarrateRx',
  sign_in_blurb  = 'Move Better Animals Chiropractic · Sign in with your @movebetter.co account'
where slug = 'movebetter-animals'
  and display_name = 'Move Better Animal Chiropractic';

-- TDC newsletter template config (workspace_credentials, service='tdc')
update workspace_credentials wc
set config = jsonb_build_object(
  'template_name', 'Move Better Animals Newsletter - Master',
  'copy_header',   'Copy into TrustDrivenCare — Move Better Animals Newsletter · Master'
)
from workspaces w
where wc.workspace_id = w.id
  and w.slug = 'movebetter-animals'
  and wc.service = 'tdc'
  and wc.config->>'template_name' = 'Move Better Animal Newsletter - Master';

commit;

-- verification (run manually):
-- select slug, display_name, app_name from workspaces where slug = 'movebetter-animals';
-- select service, config from workspace_credentials wc
--   join workspaces w on w.id = wc.workspace_id
--   where w.slug = 'movebetter-animals' and wc.service = 'tdc';
