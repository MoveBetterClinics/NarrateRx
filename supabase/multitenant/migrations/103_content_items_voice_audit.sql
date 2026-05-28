-- Migration 103: two-pass voice-fidelity audit on content_items
--
-- PR 3 of the voice-fidelity overhaul
-- (.claude/design-interview-output-voice-fidelity.md, section 6).
--
-- After a draft is generated (pass 1), a second pass audits the output
-- against the original transcript + the clinician's voice profile
-- (voicePhrases + voice_notes) + practice memory (We-lane only). The
-- audit produces a 0-100 fidelity score and a list of drift flags
-- (vocab swap, imposed structure, smoothed opinion, fabricated claim).
--
-- v1 is flag-only: the audit never mutates the stored draft. Reverts are
-- surfaced as suggestions for human review on Story Detail.

ALTER TABLE public.content_items
  -- 0-100; higher = closer to the clinician's actual voice. NULL until audited.
  ADD COLUMN IF NOT EXISTS voice_fidelity_score smallint,
  -- { score, flags:[{type,severity,excerpt,issue,suggestion}], sources:[],
  --   model, audited_at }. NULL until audited; { error } shape if a pass failed.
  ADD COLUMN IF NOT EXISTS voice_audit jsonb;

-- Story Detail and the future "needs review" surface filter low-fidelity
-- drafts within a workspace.
CREATE INDEX IF NOT EXISTS idx_content_items_voice_fidelity
  ON public.content_items (workspace_id, voice_fidelity_score)
  WHERE voice_fidelity_score IS NOT NULL;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.content_items TO service_role;
