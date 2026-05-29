-- Migration 079: extend trial from 14 days to 45 days
-- The column default is used for every new workspace INSERT (set in 035_trial_onboarding.sql).
-- Existing workspaces whose trial has not yet expired are extended; expired ones stay expired.

-- 1. Change the column default so new workspaces get 45 days.
alter table public.workspaces
  alter column trial_ends_at set default (now() + interval '45 days');

-- 2. Extend any still-active trials (not yet expired, not null) by the 31-day difference.
--    This gives existing trial users the full 45-day experience from their original start.
--    Workspaces with plan = 'internal' already have trial_ends_at = NULL and are unaffected.
update public.workspaces
set trial_ends_at = trial_ends_at + interval '31 days'
where plan = 'trial'
  and trial_ends_at is not null
  and trial_ends_at > now();

GRANT SELECT, INSERT, UPDATE, DELETE ON public.workspaces TO service_role;
