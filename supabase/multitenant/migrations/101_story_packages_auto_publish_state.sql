-- Migration 101: auto-publish evaluation state on story_packages
--
-- auto_publish_state JSONB tracks the evaluator's last verdict so the Slate
-- badge and audit log can show WHY a package was held without re-running the
-- evaluator.
--
-- Shape:
--   {
--     eligible: bool,               -- true if ALL gate signals passed
--     evaluated_at: ISO string,     -- when the evaluator last ran
--     channels: string[],           -- which channels would fire (if eligible)
--     published_channels: {         -- post-publish record per channel
--       <channel>: {
--         fired_at: ISO string,
--         content_item_id: uuid,
--         buffer_id: string | null
--       }
--     },
--     gated_reasons: [              -- signals that blocked publish (when !eligible)
--       {
--         signal: string,           -- 'voice_fidelity' | 'similarity' | 'consent' | 'qc_flag'
--         value: any,               -- observed value
--         threshold: any,           -- required value
--         detail: string            -- human-readable explanation
--       }
--     ]
--   }
--
-- auto_published_at: first timestamp at which any channel fired automatically.
-- NULL = never auto-published (approved manually).

ALTER TABLE public.story_packages
  ADD COLUMN IF NOT EXISTS auto_publish_state  jsonb,
  ADD COLUMN IF NOT EXISTS auto_published_at   timestamptz;

-- Index for the cron: pull approved packages not yet evaluated or
-- due for re-evaluation (e.g. after a consent status change).
CREATE INDEX IF NOT EXISTS idx_story_packages_auto_publish_pending
  ON public.story_packages (workspace_id, updated_at DESC)
  WHERE status = 'approved' AND auto_published_at IS NULL;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.story_packages TO service_role;
