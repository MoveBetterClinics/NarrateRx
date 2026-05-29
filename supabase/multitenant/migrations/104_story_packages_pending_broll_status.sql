-- 104_story_packages_pending_broll_status.sql
--
-- Fix: the V3 synthetic-b-roll path (api/editorial/generate-package.js) inserts
-- story_packages rows with status='pending_broll' while a Runway job runs, and
-- the UI (PackageCard.jsx, Slate.jsx) treats pending_broll as a first-class
-- lifecycle state. But 103_broll_columns.sql added the broll_status column and
-- its own CHECK without widening the parent status CHECK to allow the new value.
-- Result: every no-clips package insert violated story_packages_status_check
-- (23514) and /api/editorial/generate-package returned 500 — the whole Slate
-- generation pipeline was blocked in prod. Found 2026-05-29 during the V-series
-- smoke test.
--
-- Idempotent: drop-if-exists + re-add. No existing rows carry 'pending_broll'
-- (they all failed to insert), so no data migration is needed. Already applied
-- to prod 2026-05-29; this file is the repo record.

ALTER TABLE public.story_packages DROP CONSTRAINT IF EXISTS story_packages_status_check;
ALTER TABLE public.story_packages ADD CONSTRAINT story_packages_status_check
  CHECK (status IN ('pending','generating','complete','failed','approved','skipped','pending_broll'));
