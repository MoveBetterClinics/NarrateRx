-- 012_animals_domain_rename.sql
--
-- Rename the movebetter-animals workspace's marketing domain from
-- movebetteranimal.co → movebetteranimalchiro.com.
--
-- Touches the live row(s) only (UPDATEs, not re-seeds). The historical
-- seeds in 002_seed_movebetter.sql and 010_workspace_locations.sql are
-- left intact so the migration history reads correctly.
--
-- Scope: every column on workspaces / workspace_locations that contains
-- the old hostname for the animals workspace. Specifically:
--   workspaces.website
--   workspaces.website_hostname
--   workspaces.spoken_url
--   workspaces.internal_links_markdown
--   workspace_locations.visit_url (Portland + Vancouver rows under animals)
--
-- Intentionally NOT changed:
--   - workspaces.social (instagram/facebook handles — still 'movebetteranimal',
--     independent of the marketing domain unless the social handles are also
--     renamed, which is a separate decision).
--   - workspaces.brand_hashtag ('#MoveBetterAnimals' — a hashtag, not a URL).
--   - workspaces.display_name / app_name / sign_in_blurb — name change is
--     out of scope here. (The code-side name change to "Animals Chiropractic"
--     plural lives in src/lib/workspace.js; reconciling the DB display_name
--     is a separate cleanup if desired.)
--
-- The shared bearer secret in workspace_credentials (service='astro_github')
-- does NOT change on this rename — only the webhook URL in config.url does.
-- That update happens via the Settings UI after the new domain is live on
-- the Astro Vercel project, not in SQL (the secret column is encrypted).

begin;

-- ── workspaces ───────────────────────────────────────────────────────────────

update workspaces
set
  website          = 'https://movebetteranimalchiro.com/',
  website_hostname = 'movebetteranimalchiro.com',
  spoken_url       = 'MoveBetterAnimalChiro.com',
  internal_links_markdown = replace(internal_links_markdown, 'movebetteranimal.co', 'movebetteranimalchiro.com')
where slug = 'movebetter-animals';

-- ── workspace_locations (Portland + Vancouver rows under animals) ────────────

update workspace_locations wl
set visit_url = replace(wl.visit_url, 'movebetteranimal.co', 'movebetteranimalchiro.com')
from workspaces w
where wl.workspace_id = w.id
  and w.slug = 'movebetter-animals'
  and wl.visit_url like '%movebetteranimal.co%';

-- ── astro_github credential URL ──────────────────────────────────────────────
--
-- workspace_credentials.config is a jsonb column. The 'astro_github' row's
-- config = { url: '...' }. Update the URL while leaving the encrypted secret
-- (the bearer token) untouched. If no row exists yet (animals hasn't been
-- reconfigured post-Phase-2-cutover), this is a no-op — the user will paste
-- the new URL directly into the Settings UI.

update workspace_credentials wc
set config = jsonb_set(
  coalesce(wc.config, '{}'::jsonb),
  '{url}',
  to_jsonb(replace(wc.config->>'url', 'movebetteranimal.co', 'movebetteranimalchiro.com')),
  false
)
from workspaces w
where wc.workspace_id = w.id
  and w.slug = 'movebetter-animals'
  and wc.service = 'astro_github'
  and wc.config->>'url' like '%movebetteranimal.co%';

commit;

-- ── verification queries (run manually after applying) ───────────────────────
--
-- select slug, website, website_hostname, spoken_url
-- from workspaces where slug = 'movebetter-animals';
--
-- select label, visit_url
-- from workspace_locations wl
-- join workspaces w on w.id = wl.workspace_id
-- where w.slug = 'movebetter-animals';
--
-- select service, config->>'url' as url
-- from workspace_credentials wc
-- join workspaces w on w.id = wc.workspace_id
-- where w.slug = 'movebetter-animals' and wc.service = 'astro_github';
