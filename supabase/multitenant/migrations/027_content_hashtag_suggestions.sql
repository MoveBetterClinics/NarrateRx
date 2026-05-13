-- Add hashtag_suggestions to content_items.
--
-- Stores AI-derived hashtag candidates per content item, scoped to the
-- specific transcript + workspace metadata the post was drafted from.
-- Suggested via /api/content/suggest-hashtags, displayed as clickable
-- chips in ReviewPost. Hard constraint: every hashtag must be supported
-- by a substring of the transcript or a field of workspace metadata —
-- no invented "boost-reach" tags. Validation happens server-side before
-- saving.
--
-- Shape: jsonb array of objects, e.g.
--   [{ "tag": "#kneepain", "source": "transcript" },
--    { "tag": "#vancouver", "source": "workspace" }]
--
-- NULL = "not yet suggested." Generation is on-demand from the UI.
--
-- content_items already has full service_role grants from earlier
-- migrations; adding a column doesn't change that.

alter table public.content_items
  add column if not exists hashtag_suggestions jsonb;
