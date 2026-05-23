-- 068_interview_capture_mode_text_import.sql
--
-- Extends the capture_mode check constraint to include 'text_import' —
-- the URL-import lane where existing blog posts / articles are fetched,
-- extracted as plain text, and fed through the same synthesis pipeline
-- as voice memos (single user-role message, same content_items output).
--
-- Idempotent: drop-then-add so re-running after any constraint tweak is safe.

alter table public.interviews
  drop constraint if exists interviews_capture_mode_check;

alter table public.interviews
  add constraint interviews_capture_mode_check
    check (capture_mode in ('interview', 'voice_memo', 'seminar', 'text_import'));

-- No new columns — text_import reuses source_audio_url as source_url
-- (stores the original page URL for provenance) and leaves
-- source_audio_duration_sec null.
