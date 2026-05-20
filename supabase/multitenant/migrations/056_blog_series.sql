-- Multi-part blog series support. A long interview can be split into N (2–4)
-- linked blog posts, each a normal content_item with the three series_* fields
-- populated. NULL on all three = ordinary single-post blog (unchanged behavior).
--
-- Drives the "Split into series" action shipped 2026-05-19 in response to long
-- interviews dropping good material under the single-post template constraint.
--
-- series_id    — UUID grouping a set of parts together (one per series)
-- series_part  — 1-indexed ordinal within the series (1, 2, 3, 4)
-- series_total — denormalized N so the UI can render "Part X of Y" without
--                joining; also defends against a partial publish state.
--
-- All three columns are nullable: existing single-post blogs stay NULL on all
-- three. A row is part of a series iff series_id IS NOT NULL.

alter table public.content_items
  add column if not exists series_id    uuid,
  add column if not exists series_part  integer,
  add column if not exists series_total integer;

-- Sibling lookup runs on every series-piece render to populate the
-- "Part 1 / Part 2 / Part 3" jump links. Index on series_id makes that O(1).
create index if not exists content_items_series_id_idx
  on public.content_items (series_id)
  where series_id is not null;

-- Defense in depth against the "split called twice concurrently on the same
-- piece" race: the AI passes take 60–180s, plenty of time for a second click
-- (or tab) to fire before the first request's archive PATCH lands. The unique
-- index ensures the second request's bulk insert fails on the (interview,
-- part) overlap rather than producing duplicate parts. Application-layer
-- locking (the atomic claim PATCH in split-into-series.js) catches it earlier
-- in the common case, but the index is the backstop.
create unique index if not exists content_items_series_part_unique_idx
  on public.content_items (interview_id, series_part)
  where series_id is not null;

grant select, insert, update, delete on public.content_items to service_role;
