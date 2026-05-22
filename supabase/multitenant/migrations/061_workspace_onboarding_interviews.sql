-- One-time onboarding interview the founder runs after the signup wizard
-- creates the workspace. Output is later synthesized (P3) into four targets:
-- workspaces.tone_modifiers + voice modifiers, workspaces.patient_context,
-- workspaces.topic_suggestions, and clinicians.voice_phrases (founder's row).
--
-- A separate table from the content `interviews` table because the schemas
-- diverge: onboarding has no topic/tone/voice_mode/prototype/audience/story-type
-- and its output isn't a content piece. Keeping them apart means content-
-- interview queries don't need a `WHERE interview_type='standard'` filter
-- bolted onto every read.

CREATE TABLE IF NOT EXISTS public.workspace_onboarding_interviews (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id       uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  -- Founder's Self-clinician row. Nullable so a workspace orphaned of clinicians
  -- doesn't cascade-delete the onboarding record. SET NULL on delete preserves
  -- the transcript even if the founder's clinician row is later removed.
  clinician_id       uuid REFERENCES public.clinicians(id) ON DELETE SET NULL,
  -- Clerk user_id of the founder who ran the interview. Used for the
  -- owner-only auth check on PATCH (in addition to workspace-org gating).
  owner_id           text NOT NULL,
  -- Full transcript: [{ role: 'user'|'assistant', content: string }, ...]
  messages           jsonb NOT NULL DEFAULT '[]',
  -- Pause-resume blob. Mirrors the pattern used on public.interviews so the
  -- same beforeunload / debounced-save behavior can be ported in P2b when
  -- voice support lands.
  session_state      jsonb,
  -- in_progress  — interview running, transcript growing
  -- completed    — INTERVIEW_COMPLETE detected; awaiting synthesis (P3)
  -- synthesized  — P3 has written to the four target columns; Home card flips
  -- abandoned    — founder explicitly threw this one away (future "redo" path)
  status             text NOT NULL DEFAULT 'in_progress'
                       CHECK (status IN ('in_progress','completed','synthesized','abandoned')),
  -- P3 writes the synthesizer's structured output here for audit + replay.
  -- Shape: { tone_modifiers, patient_context, topic_suggestions, voice_phrases, model, prompt_version }.
  synthesis_result   jsonb,
  completed_at       timestamptz,
  synthesized_at     timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

-- Workspace-scoped lookup is the only query shape (the Home card asks "does
-- this workspace have a non-abandoned onboarding interview?"). Partial index
-- skips abandoned rows since they don't participate in any active query.
CREATE INDEX IF NOT EXISTS workspace_onboarding_interviews_workspace_idx
  ON public.workspace_onboarding_interviews (workspace_id, status)
  WHERE status != 'abandoned';

-- Service-role grants — REST API used by serverless functions runs as
-- service_role. Without these the route returns 403 / SQLSTATE 42501.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.workspace_onboarding_interviews TO service_role;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO service_role;
