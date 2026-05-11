-- 017_people_enable_website_publish.sql
--
-- Enable the Astro+GitHub website-publish integration for the
-- movebetter-people workspace. The matching webhook receiver lives in
-- the Move-Better/Movebetterco repo at api/publish.ts (added in
-- Movebetterco PR #42). After this migration applies, an admin pastes
-- the shared bearer secret + webhook URL into the "Astro + GitHub
-- website" card at /integrations to activate the integration.
--
-- No new tables created — only flips capabilities.websitePublish on the
-- existing workspaces row. Idempotent.

UPDATE public.workspaces
SET capabilities = jsonb_set(
  COALESCE(capabilities, '{}'::jsonb),
  '{websitePublish}',
  'true'::jsonb,
  true
)
WHERE slug = 'movebetter-people';
