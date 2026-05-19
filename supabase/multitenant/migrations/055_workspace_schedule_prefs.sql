-- Add schedule_prefs JSONB column to workspaces — per-platform optimal posting
-- day/hour overrides. When non-null, replaces the global PLATFORM_SCHEDULE_PREFS
-- defaults from src/lib/scheduleHeuristics.js for that platform. Other
-- platforms continue to use the defaults.
--
-- Shape: { [platform: string]: { days: number[], hours: number[] } | null }
--   days  — 0..6 (0=Sun, 6=Sat)
--   hours — 0..23 (local time of the viewing user; we currently render in the
--           browser's locale tz)
--   null  — explicitly "use defaults" for this platform (same as missing key)
--
-- Example:
--   {
--     "linkedin":  { "days": [2,3,4], "hours": [9,11] },
--     "instagram": { "days": [2,3,4,5,6], "hours": [10,12,14,17] }
--   }
--
-- Consumed by: suggestScheduleTime / explainPlatformSlot / isOptimalSlot /
-- isOptimalDay (src/lib/scheduleHeuristics.js).

ALTER TABLE public.workspaces
  ADD COLUMN IF NOT EXISTS schedule_prefs jsonb;

GRANT SELECT, INSERT, UPDATE ON public.workspaces TO service_role;
