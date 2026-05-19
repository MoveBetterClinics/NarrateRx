-- Add prompt_mode column to workspaces. Default 'clinical' preserves current
-- behavior for all existing workspaces. Setting to 'general' switches the
-- interview + blog prompt templates to a non-clinical variant designed for
-- founders, consultants, coaches, and other non-clinical experts.
--
-- See src/lib/prompts.js — getInterviewSystemPrompt and getBlogPostSystemPrompt
-- branch on workspace.prompt_mode. All other prompt functions continue to use
-- the clinical templates regardless of mode (general-mode users would do
-- output-side polishing for social/video/marketing batches if they need them).

ALTER TABLE public.workspaces ADD COLUMN IF NOT EXISTS prompt_mode text DEFAULT 'clinical';

-- CHECK constraint, idempotent. Wrap in DO block since Postgres lacks
-- ADD CONSTRAINT IF NOT EXISTS for tables.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'workspaces_prompt_mode_check'
  ) THEN
    ALTER TABLE public.workspaces
      ADD CONSTRAINT workspaces_prompt_mode_check
      CHECK (prompt_mode IN ('clinical','general'));
  END IF;
END $$;

-- Backfill any pre-existing NULLs to 'clinical' (column default only applies
-- to new rows; existing rows would be NULL otherwise).
UPDATE public.workspaces SET prompt_mode = 'clinical' WHERE prompt_mode IS NULL;

-- service_role already has full grants from migration 003; no additional
-- grants needed for an added column.
