-- Phase 2 — Self-serve trial + activation checklist columns.
--
-- Adds five columns to workspaces to support:
--   trial_started_at       — when the trial began (defaults to row creation time)
--   trial_ends_at          — trial expiry (defaults to 14 days from creation)
--   onboarding_completed_at — set when all 4 activation steps are done
--   onboarding_steps_done  — JSONB array of manually-marked steps (supplemental;
--                            /api/onboarding/progress also auto-detects from live data)
--   plan                   — 'trial' | 'paid' | 'internal' — workspace billing tier
--
-- No explicit GRANT needed — workspaces already has service_role access from
-- the earlier 003_grant_service_role.sql migration.

alter table public.workspaces
  add column if not exists trial_started_at timestamptz default now(),
  add column if not exists trial_ends_at timestamptz default (now() + interval '14 days'),
  add column if not exists onboarding_completed_at timestamptz,
  add column if not exists onboarding_steps_done jsonb default '[]'::jsonb,
  add column if not exists plan text not null default 'trial';

-- Index for querying trials nearing expiry (future cron jobs)
create index if not exists workspaces_trial_ends_at_idx
  on public.workspaces (trial_ends_at)
  where plan = 'trial';
