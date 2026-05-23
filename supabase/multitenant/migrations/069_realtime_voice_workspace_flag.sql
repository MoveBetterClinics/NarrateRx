-- 069_realtime_voice_workspace_flag.sql
--
-- Phase 5 Feature #1 — phone-call mode.
--
-- Two changes:
--   1. workspaces.realtime_voice_enabled — per-tenant feature flag. Default
--      false. Flipped to true for Move Better as soon as this migration is
--      applied. External tenants stay off until the spike is promoted out of
--      Beta (target: after Move Better completes 5 successful real interviews
--      on it).
--   2. interviews.capture_mode check constraint — add 'realtime_voice' as a
--      valid value so the realtime call's interview row can be distinguished
--      from chat interviews in Stories analytics + completion reporting.
--
-- Idempotent: every statement uses IF [NOT] EXISTS or drop-then-add so re-runs
-- are safe.

alter table public.workspaces
  add column if not exists realtime_voice_enabled boolean not null default false;

comment on column public.workspaces.realtime_voice_enabled is
  'Phase 5 Feature #1 flag. When true, the Capture Picker shows the Phone Call tile and /new/phone-call is reachable.';

-- Extend capture_mode constraint to recognize 'realtime_voice'. Same
-- drop-then-add pattern used by 067/068; safe to re-run.
alter table public.interviews
  drop constraint if exists interviews_capture_mode_check;

alter table public.interviews
  add constraint interviews_capture_mode_check
    check (capture_mode in ('interview', 'voice_memo', 'seminar', 'text_import', 'realtime_voice'));

-- service_role already has the grants on workspaces / interviews from earlier
-- migrations; nothing new to grant here. The new column inherits the existing
-- column-level grant from `GRANT … ON public.workspaces TO service_role`.
