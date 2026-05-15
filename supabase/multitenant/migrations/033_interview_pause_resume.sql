-- Add session_state and paused_at to interviews for pause/resume support.
-- session_state stores the full conversation transcript (messages array) so staff
-- can close the browser mid-interview and return to find the session intact.
-- paused_at tracks when the session was last persisted.

alter table public.interviews
  add column if not exists session_state jsonb,
  add column if not exists paused_at timestamptz;

grant select, insert, update, delete on public.interviews to service_role;
