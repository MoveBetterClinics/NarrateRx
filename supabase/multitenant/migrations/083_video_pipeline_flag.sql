-- 083_video_pipeline_flag.sql
-- Adds the video_pipeline_enabled feature flag to workspaces.
-- Phase 0 of the 30-day video output build (2026-05-26).
--
-- Default FALSE — enabled per-workspace once Phase 5 integration ships.
-- Mirrors the realtime_voice_enabled / patient_handouts_enabled pattern.

ALTER TABLE public.workspaces
  ADD COLUMN IF NOT EXISTS video_pipeline_enabled boolean NOT NULL DEFAULT false;

-- workspaces is already granted to service_role; no additional grants needed.
