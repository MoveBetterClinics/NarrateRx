-- Phase C — voice-faithful output loop: scaffolding only.
--
-- Per-clinician structured voice substrate. Today's clinicians.voice_notes is
-- a human-readable distillation written by an AI; this table holds the
-- frequency-weighted phrases that distillation is (eventually) derived from.
--
-- This migration creates the table and the read indexes. Backfill from
-- content_items, write events on approve/reject, and the diff-view
-- annotations all land in follow-up PRs — see development-roadmap-phase-4.md
-- sections C.1–C.4.

CREATE TABLE IF NOT EXISTS public.clinician_voice_phrases (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id       uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  clinician_id       uuid NOT NULL REFERENCES public.clinicians(id) ON DELETE CASCADE,

  -- The clinician's preserved phrasing, exactly as written (case + punctuation kept).
  phrase             text NOT NULL,

  -- Normalized form for dedup + lookup (lowercased, leading/trailing whitespace and
  -- terminal punctuation trimmed). Computed in app code; the column exists so the
  -- unique index can rest on it without a generated-column dependency.
  phrase_normalized  text NOT NULL,

  -- Net weight: positive when the phrase was kept across accepted drafts, negative
  -- when actively edited out. Auto-tune (C.3) updates this on approve/reject events.
  -- numeric instead of int because future tuners may apply fractional weight to
  -- partial matches or recency-decay multipliers.
  weight             numeric(8,2) NOT NULL DEFAULT 1.0,

  -- Denormalized counts. Cheap to read for the "top phrasings" UI; the auto-tune
  -- worker maintains these alongside the weight update.
  approve_count      integer NOT NULL DEFAULT 0,
  reject_count       integer NOT NULL DEFAULT 0,

  first_seen_at      timestamptz NOT NULL DEFAULT now(),
  last_seen_at       timestamptz NOT NULL DEFAULT now(),
  created_at         timestamptz NOT NULL DEFAULT now()
);

-- Most queries fetch all phrases for a single (workspace, clinician) pair, sorted by
-- weight. This composite index covers both filter columns plus the ORDER BY.
CREATE INDEX IF NOT EXISTS clinician_voice_phrases_lookup_idx
  ON public.clinician_voice_phrases (workspace_id, clinician_id, weight DESC, last_seen_at DESC);

-- Workspace-level scans (admin reports, audits) — covered separately so the
-- planner doesn't need the clinician_id column.
CREATE INDEX IF NOT EXISTS clinician_voice_phrases_workspace_idx
  ON public.clinician_voice_phrases (workspace_id);

-- Dedup: at most one row per clinician+normalized phrase. The auto-tune worker
-- uses this for UPSERT-style updates (ON CONFLICT (workspace_id, clinician_id, phrase_normalized)).
CREATE UNIQUE INDEX IF NOT EXISTS clinician_voice_phrases_uniq_idx
  ON public.clinician_voice_phrases (workspace_id, clinician_id, phrase_normalized);

-- Service-role grants — REST API used by serverless functions runs as service_role.
-- Without these the route returns 403 / SQLSTATE 42501. Per CLAUDE.md migrations
-- must self-include grants rather than relying on the legacy 003_grant_service_role.sql.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.clinician_voice_phrases TO service_role;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO service_role;
