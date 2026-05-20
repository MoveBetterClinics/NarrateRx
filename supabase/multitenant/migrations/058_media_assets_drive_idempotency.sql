-- Idempotency guard for Drive imports.
--
-- The Drive importer writes one media_assets row per imported file with
-- source='drive' and drive_id=<google file id>. If the user accidentally
-- selects the same file twice (different sessions, a refresh during browse,
-- two tabs open) we don't want a duplicate row — the importer checks this
-- index up-front and returns "already in Library" for any pre-existing
-- (workspace_id, drive_id) pair.
--
-- Partial because drive_id is null for the overwhelming majority of rows
-- (everything that came in via direct upload). The unique constraint only
-- needs to hold for the source='drive' subset.
--
-- Note that workspace_id is part of the key — re-importing the same Drive
-- file ID into a *different* workspace is allowed (and creates an independent
-- copy in that workspace's Library).
create unique index if not exists media_assets_workspace_drive_id_uniq
  on public.media_assets (workspace_id, drive_id)
  where drive_id is not null and source = 'drive';
