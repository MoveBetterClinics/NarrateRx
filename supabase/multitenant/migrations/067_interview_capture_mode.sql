-- 067_interview_capture_mode.sql
--
-- Voice Memo Lane (Phase 1): extend `interviews` to host non-interview captures
-- (voice memos today, seminars next phase). We reuse the existing table because
-- the downstream pipeline (synthesis → content_items) treats `messages` as
-- opaque input; a voice memo is stored as a single user-role message and rides
-- the same rails as a chat-shaped interview.
--
-- New columns:
--   capture_mode               'interview' | 'voice_memo' | 'seminar'
--   source_audio_url           Vercel Blob URL of the raw recording
--   source_audio_duration_sec  seconds; used for UI + analytics
--
-- All existing rows are AI-driven chat interviews → backfill to 'interview'.
-- The check constraint locks the set so a typo can't silently land bad data.

alter table public.interviews
  add column if not exists capture_mode text not null default 'interview',
  add column if not exists source_audio_url text,
  add column if not exists source_audio_duration_sec integer;

-- Idempotent constraint add. Drop-then-add so re-running the migration after
-- a column-type change (or after a check tweak in a later migration) doesn't
-- error on the already-existing constraint name.
alter table public.interviews
  drop constraint if exists interviews_capture_mode_check;

alter table public.interviews
  add constraint interviews_capture_mode_check
    check (capture_mode in ('interview', 'voice_memo', 'seminar'));

-- Backfill safety: any historical row that somehow lacks capture_mode (default
-- only applies to inserts) gets the canonical value. No-op on fresh DBs.
update public.interviews
  set capture_mode = 'interview'
  where capture_mode is null;

-- Index on (workspace_id, capture_mode) so the "Real moments" filter on
-- content_items (joined via interview_id) can prune the interview side fast.
create index if not exists interviews_workspace_capture_mode_idx
  on public.interviews(workspace_id, capture_mode);

-- service_role grants. New columns inherit table-level grants automatically,
-- but re-stating here keeps this migration self-sufficient per CLAUDE.md.
grant select, insert, update, delete on public.interviews to service_role;
