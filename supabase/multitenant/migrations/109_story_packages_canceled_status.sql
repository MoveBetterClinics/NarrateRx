-- 109_story_packages_canceled_status.sql
--
-- Fix: PR #1011 added a cooperative "Stop" on the Story Slate that PATCHes a
-- still-generating package to status='canceled' (api/editorial/packages/[id].js,
-- with matching guards in renderPackageChannels.js / syntheticBroll.js). But
-- 'canceled' was never added to the story_packages_status_check CHECK constraint
-- (last set in 104), so every Stop click violated the constraint (23514) and
-- /api/editorial/packages/:id returned db_error — the Slate showed a persistent
-- "db_error" toast. Same failure mode as 104 (a new lifecycle value shipped
-- without widening the parent CHECK). Found 2026-05-30 right after the PR #1011
-- deploy.
--
-- Idempotent: drop-if-exists + re-add. No data migration needed — rows that
-- failed the constraint were never written.

ALTER TABLE public.story_packages DROP CONSTRAINT IF EXISTS story_packages_status_check;
ALTER TABLE public.story_packages ADD CONSTRAINT story_packages_status_check
  CHECK (status IN ('pending','generating','complete','failed','approved','skipped','pending_broll','canceled'));
