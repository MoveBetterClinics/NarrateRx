-- Voice memory: per-clinician patterns distilled from how they edit AI drafts.
-- The AI's original output is captured at insert time and never overwritten,
-- so (ai_original_content vs. content) is the diff for any published piece.
-- A background-or-manual refresh distills those diffs into voice_notes text,
-- which is then injected into every prompt for that clinician.

ALTER TABLE public.clinicians
  ADD COLUMN IF NOT EXISTS voice_notes                text,
  ADD COLUMN IF NOT EXISTS voice_notes_refreshed_at   timestamptz,
  ADD COLUMN IF NOT EXISTS voice_notes_edits_analyzed integer NOT NULL DEFAULT 0;

ALTER TABLE public.content_items
  ADD COLUMN IF NOT EXISTS ai_original_content text;

-- Service-role grants are inherited from migration 003 for both tables.
-- Re-declaring here is harmless and keeps the migration self-sufficient.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.clinicians    TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.content_items TO service_role;
