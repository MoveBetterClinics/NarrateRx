-- Pull-quote candidates for an interview.
--
-- Stores 3-5 verbatim sentences from the transcript that work as
-- shareable pull quotes — extracted (not invented) via
-- /api/interviews/pull-quotes. Validated server-side: each candidate
-- must be an exact substring of the transcript before being saved.
-- If a candidate fails the substring check, it's dropped on the floor
-- — never persisted, never shown.
--
-- Shape of pull_quote_candidates: jsonb array of
--   { "id": "<uuid>", "quote": "<verbatim sentence>",
--     "start_offset": <int>, "end_offset": <int> }
-- The id is a stable client-generated handle so the UI's selected-quote
-- pointer (pull_quote_selected_id) doesn't break when candidates are
-- regenerated.
--
-- interviews already has full service_role grants from earlier
-- migrations; adding columns doesn't change that.

alter table public.interviews
  add column if not exists pull_quote_candidates jsonb;

alter table public.interviews
  add column if not exists pull_quote_selected_id text;
