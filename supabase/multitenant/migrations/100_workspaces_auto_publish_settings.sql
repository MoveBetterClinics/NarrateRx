-- Migration 100: per-workspace auto-publish settings
--
-- Adds workspaces.auto_publish_settings JSONB.
-- Shape: { <channel>: { enabled: bool, voice_fidelity_min: number, similarity_min: number } }
-- Default {} means all channels OFF (explicit opt-in required).
--
-- Channels that will be supported as the feature rolls out:
--   gbp | instagram | facebook | linkedin | tiktok | youtube | blog
-- Only 'gbp' is wired at launch; others require channel-specific work.

ALTER TABLE public.workspaces
  ADD COLUMN IF NOT EXISTS auto_publish_settings jsonb NOT NULL DEFAULT '{}';

-- Partial index for workspaces that have any auto-publish channel enabled.
-- The cron reads this to skip workspaces with no active channels.
CREATE INDEX IF NOT EXISTS idx_workspaces_auto_publish_enabled
  ON public.workspaces ((auto_publish_settings IS DISTINCT FROM '{}'))
  WHERE auto_publish_settings IS DISTINCT FROM '{}';

GRANT SELECT, UPDATE ON public.workspaces TO service_role;
