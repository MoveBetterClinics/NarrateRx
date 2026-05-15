-- Cleaned-transcript pass for an interview.
--
-- Raw Web Speech transcripts (interviews.messages) carry filler words ("um",
-- "uh", "you know" as filler) and mis-transcriptions of medical terms
-- ("fascia" → "fashion", "scapula" → "scapular" etc). We run a cleanup pass
-- after the interview finalizes and persist the cleaned message array
-- separately so the original stays as ground truth — the editor can always
-- toggle back to verify the cleanup didn't drift.
--
-- Shape mirrors interviews.messages: jsonb array of
--   { "role": "user" | "assistant", "content": "..." }
--
-- transcript_glossary on workspaces is the per-tenant override layer for the
-- shared medical glossary in src/lib/medicalGlossary.js. Shape:
--   { "terms": ["fascia", "dorsiflexion", ...],
--     "fillers": ["um", "uh", ...] }
-- Either key may be omitted; the cleanup handler falls back to the seed
-- glossary when a key is missing.
--
-- interviews and workspaces already have full service_role grants from
-- earlier migrations; adding columns doesn't change that. No new tables
-- here, so no fresh GRANT block is required.

alter table public.interviews
  add column if not exists cleaned_messages jsonb;

alter table public.workspaces
  add column if not exists transcript_glossary jsonb;
