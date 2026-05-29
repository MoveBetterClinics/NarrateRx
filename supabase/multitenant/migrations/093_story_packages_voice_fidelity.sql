-- Migration 093: voice_fidelity_score + breakdown on story_packages
--
-- Filename note: this migration was originally numbered 092 (PR #902,
-- merged 2026-05-28 05:58Z). PR #901 (workspaces.role_templates) also
-- landed at 092 ~30 min earlier on the same day, so this one is renamed
-- to 093 per the CLAUDE.md ordering rule ("sequential numeric prefixes,
-- not shared"). The DDL itself was already applied to prod under the
-- old name via Supabase MCP — this rename is filesystem-cosmetic only,
-- and the IF NOT EXISTS guards make any re-application a no-op.
--
-- V1 of the "Deepen the video build" extension set.
-- Captions are now the highest-volume text the product emits. The voice
-- fidelity scorer (scripts/voice-fidelity-captions.mjs) scores caption_text
-- + topic against the clinician's voice phrase corpus and persists the
-- result here so:
--   1. The CI gate (scripts/verify-caption-fidelity.mjs) can fail builds
--      when avg fidelity dips below baseline.
--   2. The Story Director Slate can surface a fidelity badge on each card.
--
-- score: 1.0–10.0 (single overall, mirrors voice-fidelity-score.mjs averaging).
-- breakdown: { voice_fidelity, clinical_texture, redundancy, specificity,
--              brand_fit, red_flag, scored_at, model } — full evaluator output.

ALTER TABLE public.story_packages
  ADD COLUMN IF NOT EXISTS voice_fidelity_score numeric;

ALTER TABLE public.story_packages
  ADD COLUMN IF NOT EXISTS voice_fidelity_breakdown jsonb;

-- Partial index — most queries filter on packages WITH a score (the badge
-- only renders when present; the gate query selects scored rows).
CREATE INDEX IF NOT EXISTS idx_story_packages_voice_fidelity_score
  ON public.story_packages (workspace_id, voice_fidelity_score DESC)
  WHERE voice_fidelity_score IS NOT NULL;

-- Service-role grants are inherited from migration 088's GRANT on the
-- table itself (column-level adds inherit table-level privileges), but we
-- re-state explicitly per CLAUDE.md convention so each migration is
-- self-sufficient if 088 is ever re-baselined.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.story_packages TO service_role;
