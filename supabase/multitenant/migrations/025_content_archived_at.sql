-- Soft-delete (archive) support for content_items. Editors will want to clear
-- out drafts they don't intend to use without permanently losing them — a
-- separate `archived_at` column keeps the lifecycle status (draft/in_review/
-- approved/scheduled/published) orthogonal to archive state, so unarchiving
-- naturally restores the prior status.
--
-- Hard delete remains available via DELETE /api/db/content for true teardown.

ALTER TABLE public.content_items
  ADD COLUMN IF NOT EXISTS archived_at timestamptz;

-- Partial index — only archived rows are worth indexing; the default list
-- query filters `archived_at IS NULL` which is satisfied by the existing
-- workspace_id/created_at indexes.
CREATE INDEX IF NOT EXISTS content_items_archived_at_idx
  ON public.content_items (workspace_id, archived_at DESC)
  WHERE archived_at IS NOT NULL;
