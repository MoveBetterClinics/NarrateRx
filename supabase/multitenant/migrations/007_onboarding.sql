-- Phase 1E — onboarding wizard support.
--
-- Adds three columns used by self-serve workspace creation on narraterx.ai/onboard:
--   is_founding              — true for the first 10 external workspaces (price-locked later)
--   brandbook                — jsonb { url, notes } for tenant brandbook reference
--   created_by_clerk_user_id — Clerk user id of the person who claimed the workspace
--
-- Move Better's three pre-seeded workspaces stay is_founding=false (they predate the program).
-- Run via Supabase SQL Editor on the shared narraterx project.

alter table workspaces
  add column if not exists is_founding boolean not null default false,
  add column if not exists brandbook jsonb default '{}'::jsonb,
  add column if not exists created_by_clerk_user_id text;

create index if not exists workspaces_is_founding_idx on workspaces(is_founding) where is_founding = true;
