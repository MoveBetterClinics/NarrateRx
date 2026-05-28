-- Migration 094: weekly engagement digest configuration
--
-- Phase 4 PR 5: per-workspace opt-in for the Monday-morning producer digest.
--
-- engagement_digest_enabled — master switch. When false, no email is sent
--   for this workspace even if recipients are listed.
-- engagement_digest_recipients — Clerk user IDs that should receive the
--   email. Empty array = derive recipients from clinicians.permission_tier
--   ('producer' tier members get the email automatically). Explicit list
--   wins when non-empty.
-- engagement_digest_last_sent_at — when the most recent digest was sent.
--   Used by the cron to avoid double-firing within a 6-day window even if
--   it runs on different days due to schedule drift.

ALTER TABLE public.workspaces
  ADD COLUMN IF NOT EXISTS engagement_digest_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS engagement_digest_recipients text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS engagement_digest_last_sent_at timestamptz;

COMMENT ON COLUMN public.workspaces.engagement_digest_enabled IS
  'Master switch for the weekly producer engagement digest cron. Default false; admins opt in per workspace.';
COMMENT ON COLUMN public.workspaces.engagement_digest_recipients IS
  'Clerk user IDs to email. Empty = auto-derive from clinicians where permission_tier=''producer''.';
COMMENT ON COLUMN public.workspaces.engagement_digest_last_sent_at IS
  'Most recent digest send timestamp. Cron uses this to prevent double-send within 6 days.';
