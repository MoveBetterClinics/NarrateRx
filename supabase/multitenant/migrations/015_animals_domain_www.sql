-- 015_animals_domain_www.sql (was 014 — bumped one in the follow-up PR
-- that resolved a 012 prefix collision; already applied to prod under
-- the old name).
--
-- Follow-up to 013_animals_domain_rename.sql. The primary domain set on
-- the Astro Vercel project is `www.movebetteranimalchiro.com` (the apex
-- `movebetteranimalchiro.com` 307-redirects to the www form). Update the
-- canonical URLs stored in the workspaces row to match the primary, so
-- blog post links emitted by NarrateRx don't all eat an extra redirect
-- hop.
--
-- Only the canonical URL fields change. The webhook URL stored in
-- workspace_credentials.config.url should also be www-form for consistency,
-- so we update that too if a row exists.

begin;

update workspaces
set
  website                 = 'https://www.movebetteranimalchiro.com/',
  internal_links_markdown = replace(internal_links_markdown, 'https://movebetteranimalchiro.com/', 'https://www.movebetteranimalchiro.com/')
where slug = 'movebetter-animals';

update workspace_locations wl
set visit_url = replace(wl.visit_url, 'https://movebetteranimalchiro.com/', 'https://www.movebetteranimalchiro.com/')
from workspaces w
where wl.workspace_id = w.id
  and w.slug = 'movebetter-animals'
  and wl.visit_url like 'https://movebetteranimalchiro.com/%';

update workspace_credentials wc
set config = jsonb_set(
  coalesce(wc.config, '{}'::jsonb),
  '{url}',
  to_jsonb(replace(wc.config->>'url', 'https://movebetteranimalchiro.com/', 'https://www.movebetteranimalchiro.com/')),
  false
)
from workspaces w
where wc.workspace_id = w.id
  and w.slug = 'movebetter-animals'
  and wc.service = 'astro_github'
  and wc.config->>'url' like 'https://movebetteranimalchiro.com/%';

-- website_hostname stays as the bare apex `movebetteranimalchiro.com` —
-- it's used for display labels ("Publish to movebetteranimalchiro.com") and
-- the bare form reads cleaner. spoken_url likewise stays `MoveBetterAnimalChiro.com`.

commit;
