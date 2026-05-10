-- Phase 1F (PR 2) — move the remaining brands/<id>/ overlay content into
-- per-workspace JSONB columns:
--   * patient_context     — primary avatar, prototypes, prior-provider pain
--                           points, staff profiles, and the summary blurb
--                           that prompts.js previously hard-coded.
--   * interview_context   — { conditions, keywordAliases, fallback } —
--                           the PNW condition bank + fuzzy keyword matcher
--                           data. Equine renamed PNW_HORSE_CONDITION_BANK
--                           collapses into the same shape.
--   * topic_suggestions   — array of { topic, category, priority, keywords[],
--                           pnwNote } used by the Dashboard "topic gaps"
--                           panel and the New Interview suggestions.
--
-- This migration only adds columns; data is seeded by
-- scripts/seed-workspace-paradigm-content.mjs which reads the existing
-- brands/<id>/{patient,interview,topic}*.js literals and PATCHes the
-- three Move Better workspaces by slug. PR 3 deletes the overlay files
-- once that script has been run.

alter table workspaces
  add column if not exists patient_context   jsonb default '{}'::jsonb,
  add column if not exists interview_context jsonb default '{}'::jsonb,
  add column if not exists topic_suggestions jsonb default '[]'::jsonb;
