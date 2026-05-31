-- Drop the legacy workspace-blind unique key on practice_memory_chunks.
--
-- Superseded by practice_memory_chunks_ws_source_uniq_idx (migration 112),
-- which adds workspace_id so the same source_id can live in multiple
-- workspaces (a workspace's own Practice Mode copy + the qbook Author-Mode
-- mirror). While this 3-col index still exists it BLOCKS that coexistence
-- (an INSERT of the same source_id under a second workspace violates it).
--
-- Apply ONLY after the code using
-- on_conflict=(workspace_id,source_type,source_id,chunk_index) is deployed, so
-- PostgREST always has a matching unique index for its upserts (otherwise the
-- indexers 42P10 until the new index exists).

DROP INDEX IF EXISTS public.practice_memory_chunks_source_uniq_idx;
