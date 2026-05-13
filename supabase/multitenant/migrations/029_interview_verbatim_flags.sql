-- Verbatim flags on an interview.
--
-- During transcript review, the clinician/editor selects exact passages
-- they want preserved word-for-word in every draft. Stored as a JSONB
-- array of { id, text, start_offset, end_offset, created_at }. The
-- drafting + redrafting prompts (getBlogPostSystemPrompt, regenerate)
-- read this array and inject a "MUST preserve these exact phrases"
-- constraint when flags exist.
--
-- text must be an exact substring of the transcript at the moment of
-- flagging — UI and API enforce this so a stale or hand-edited flag
-- doesn't end up as an invented quote in the output.
--
-- interviews already has full service_role grants from earlier
-- migrations; adding a column doesn't change that.

alter table public.interviews
  add column if not exists verbatim_flags jsonb;
