-- Phase 1 of pre-interview controls — workspaces curate the audience and
-- story-type slots that appear on the New Interview form. Two new JSONB
-- columns hold the slot arrays. Each slot is a full object so the UI can
-- render without joining back to the catalog and admins can override
-- catalog labels per workspace:
--
--   { key: 'chronic_pain', label: 'Chronic pain', emoji: '🩹',
--     description: 'Long-standing or recurring pain', is_custom: false }
--
-- Catalog keys live in src/lib/interviewOptionsCatalog.js. Server-side
-- validation in api/workspace/me.js enforces the 6 catalog + 2 custom
-- slot caps and the object shape.
--
-- Existing workspaces are seeded with a starter set of 4 universal audiences
-- and 4 universal story types so the New Interview form has something to
-- show immediately. Admins curate from /settings/workspace/voice.

alter table public.workspaces
  add column if not exists audience_options   jsonb not null default '[]'::jsonb,
  add column if not exists story_type_options jsonb not null default '[]'::jsonb;

-- Seed default audience slots for any workspace that doesn't have any yet.
update public.workspaces
set audience_options = '[
  {"key":"general_public","label":"General public","emoji":"👥","description":"Anyone with the condition","is_custom":false},
  {"key":"active_adults","label":"Active adults","emoji":"🏃","description":"Runners, lifters, weekend warriors","is_custom":false},
  {"key":"referring_providers","label":"Referring providers","emoji":"🩺","description":"GPs, orthos, sports med","is_custom":false},
  {"key":"other_clinicians","label":"Other clinicians","emoji":"🧑‍⚕️","description":"Peer PTs, chiros, DOs","is_custom":false}
]'::jsonb
where jsonb_array_length(audience_options) = 0;

-- Seed default story-type slots for any workspace that doesn't have any yet.
update public.workspaces
set story_type_options = '[
  {"key":"principle_explainer","label":"Principle explainer","emoji":"💡","description":"How a concept works","is_custom":false},
  {"key":"myth_buster","label":"Myth-buster","emoji":"⚡","description":"What people get wrong","is_custom":false},
  {"key":"process_walkthrough","label":"Process walkthrough","emoji":"🔧","description":"What treatment looks like","is_custom":false},
  {"key":"patient_case","label":"Patient case","emoji":"👤","description":"Walk through a specific case","is_custom":false}
]'::jsonb
where jsonb_array_length(story_type_options) = 0;

-- service_role grants — required so REST API can read/write these columns.
-- workspaces already has service_role grants from earlier migrations, but
-- per the project rule (CLAUDE.md "Supabase migrations") we bundle grants
-- in every migration that touches schema so each file is self-sufficient.
grant select, insert, update, delete on public.workspaces to service_role;
