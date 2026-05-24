-- 071_realtime_voice_daily_cap.sql
--
-- Phase 5 Feature #1 polish — per-workspace daily minute cap for Live
-- Interview (realtime voice). Without a cap, a runaway client (or a
-- well-intentioned tenant with too many sessions) can rack up real
-- OpenAI Realtime spend in a day. Default 60 min/day is enough for the
-- expected dogfood pattern (1–2 calls/day) but blocks accidental loops.
--
-- Two changes:
--   1. workspaces.realtime_voice_daily_cap_min — admin-configurable cap,
--      in whole minutes. Default 60. NULL means "unlimited" — reserved
--      for ops escalations, not exposed in the settings UI by default.
--   2. interviews.realtime_voice_seconds — actual session duration in
--      seconds, set by the client when the call ends. Used by
--      api/realtime-session.js to sum today's usage before minting a
--      new token. NULL = session never completed (rare: tab killed
--      before hangup); those rows don't contribute to the day's total.
--
-- Idempotent: every statement uses IF [NOT] EXISTS.

alter table public.workspaces
  add column if not exists realtime_voice_daily_cap_min int default 60;

comment on column public.workspaces.realtime_voice_daily_cap_min is
  'Phase 5 Feature #1 — daily minute cap for Live Interview voice calls. NULL = unlimited (ops only). Default 60 min.';

alter table public.interviews
  add column if not exists realtime_voice_seconds int;

comment on column public.interviews.realtime_voice_seconds is
  'Phase 5 Feature #1 — actual duration of the realtime voice session in seconds. Set by PhoneCall.jsx on hangup. NULL for non-realtime interviews and for sessions abandoned before hangup.';

-- service_role already has full DML on workspaces / interviews from
-- earlier migrations; new columns inherit the existing table-level grant.
