-- Add buffer_use_queue toggle to workspaces. When true, the post-approval
-- action sheet defaults its primary CTA to "Add to Buffer queue" (Buffer's
-- shareNext mode — next open slot in the channel's existing schedule)
-- instead of computing a specific time via the platform heuristic.
--
-- Users who have tuned their Buffer posting schedule trust Buffer's queue
-- more than NarrateRx's static PLATFORM_SCHEDULE_PREFS table; this flag lets
-- them say "use yours, not ours" once instead of per-post.

ALTER TABLE public.workspaces
  ADD COLUMN IF NOT EXISTS buffer_use_queue boolean NOT NULL DEFAULT false;

GRANT SELECT, INSERT, UPDATE ON public.workspaces TO service_role;
