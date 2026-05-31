-- Practice-memory chunks: make the upsert/uniqueness key workspace-aware.
--
-- The original unique key was (source_type, source_id, chunk_index) — it
-- assumed a given source row belongs to exactly one workspace. That assumption
-- is false: the qbook Author-Mode cron (api/cron/sync-author-corpus.js) mirrors
-- Q's movebetter-people interviews into the qbook workspace under the SAME
-- source_id, and the new per-workspace live transcript hook
-- (api/db/interviews.js) indexes interviews into their own workspace. With the
-- old key those two writers collide on upsert and clobber each other — only one
-- workspace_id survives per chunk, which is why transcript chunks were split
-- nondeterministically across qbook and movebetter-people.
--
-- Two-step, zero-downtime rollout:
--   112 (this file): CREATE the new 4-col unique index alongside the old one.
--                    Apply BEFORE deploying the code that upserts on the 4-col
--                    key. Both indexes coexist; existing single-workspace rows
--                    are trivially unique on the superset, so creation cannot
--                    fail on current data, and the old code's 3-col on_conflict
--                    keeps working until the new code ships.
--   113: DROP the old 3-col index. Apply AFTER the new code is deployed.
--
-- No GRANT needed (index on an already-granted table).

CREATE UNIQUE INDEX IF NOT EXISTS practice_memory_chunks_ws_source_uniq_idx
  ON public.practice_memory_chunks (workspace_id, source_type, source_id, chunk_index);
