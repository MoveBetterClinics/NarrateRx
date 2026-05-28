-- Migration 090: expand story_packages.status to include 'approved' and 'skipped'
--
-- Phase 3 Story Director (PR 1 + PR 2) needs two additional status values:
--   'skipped'  — clinician dismissed the package from the slate (PATCH /api/editorial/packages/:id)
--   'approved' — clinician approved; content_items rows have been created in Drafts
--                (POST /api/editorial/approve-package)
--
-- PostgreSQL does not support ALTER TABLE ... ALTER CONSTRAINT directly,
-- so we drop the old inline check and re-add the expanded version.
-- This is safe: no existing rows have status='approved' or status='skipped'.

ALTER TABLE public.story_packages
  DROP CONSTRAINT IF EXISTS story_packages_status_check;

ALTER TABLE public.story_packages
  ADD CONSTRAINT story_packages_status_check
  CHECK (status IN ('pending', 'generating', 'complete', 'failed', 'approved', 'skipped'));
