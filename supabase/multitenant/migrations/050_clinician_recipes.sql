-- 050_clinician_recipes.sql
--
-- Replaces the single per-clinician default recipe (migration 049's four
-- default_* columns) with a proper recipes table — each clinician can save
-- multiple named bundles (e.g. "Patient story for IG", "Provider referral
-- explainer") and star one as the default. Adds cleanup_level as a fifth
-- lever for transcript faithfulness ("stay close to my words" → polished).
--
-- The Phase 4 default_* columns stay in place for now (backfilled into a
-- "Default" recipe row below) so nothing breaks during the rollout. A
-- follow-up migration will drop them once all clients read from the
-- recipes table only.

create table if not exists public.clinician_recipes (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null references public.workspaces(id) on delete cascade,
  clinician_id    uuid not null references public.clinicians(id) on delete cascade,
  name            text not null,
  emoji           text default '⭐',
  is_default      boolean default false,
  audience        text,
  story_type      text,
  tone            text,
  voice_mode      text,
  cleanup_level   text,
  created_at      timestamptz default now(),
  updated_at      timestamptz default now()
);

create index if not exists clinician_recipes_clinician_idx
  on public.clinician_recipes (clinician_id);

-- Only one default recipe per clinician
create unique index if not exists clinician_recipes_one_default_idx
  on public.clinician_recipes (clinician_id)
  where is_default = true;

grant select, insert, update, delete on public.clinician_recipes to service_role;
grant usage on all sequences in schema public to service_role;

-- New cleanup-aggressiveness lever on interviews. Values: 'verbatim'
-- (faithful to spoken words, minimal cleanup), 'balanced' (default —
-- remove fillers + fix mis-transcriptions), 'polished' (also restructure
-- run-ons and condense fragmented thoughts).
alter table public.interviews
  add column if not exists cleanup_level text;

-- Backfill: every clinician with any Phase 4 default_* set becomes a
-- "Default" recipe row marked is_default=true. Clinicians with no defaults
-- get no row — the New Interview UI will create one on first use.
insert into public.clinician_recipes (workspace_id, clinician_id, name, emoji, is_default, audience, story_type, tone, voice_mode)
select
  c.workspace_id,
  c.id,
  'Default',
  '⭐',
  true,
  c.default_audience,
  c.default_story_type,
  c.default_tone,
  c.default_voice_mode
from public.clinicians c
where
  (c.default_audience   is not null
   or c.default_story_type is not null
   or c.default_tone       is not null
   or c.default_voice_mode is not null)
  and not exists (
    select 1 from public.clinician_recipes r where r.clinician_id = c.id
  );
