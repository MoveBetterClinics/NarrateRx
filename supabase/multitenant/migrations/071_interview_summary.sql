-- Phase 5 Feature 2 (PR 2) — interview summaries for practice memory.
--
-- Stores a 3–5 sentence distillation of each completed interview so the
-- hot-context block in subsequent interview prompts can reference many
-- prior sessions without exploding the token budget. Generated once on
-- interview completion (see api/_lib/interviewSummarizer.js); backfilled
-- for existing rows via scripts/backfill-interview-summaries.mjs.
--
-- summary_text is plain text (no markdown). summary_generated_at is set
-- to NOW() on successful generation so a later re-run script can skip
-- already-summarized rows and a future change to the summarizer prompt
-- can target rows summarized before a cutover date.

ALTER TABLE public.interviews
  ADD COLUMN IF NOT EXISTS summary_text text,
  ADD COLUMN IF NOT EXISTS summary_generated_at timestamptz;

-- service_role already has table-level grants from migration 003, but
-- new columns inherit those by default. No additional GRANT needed.
