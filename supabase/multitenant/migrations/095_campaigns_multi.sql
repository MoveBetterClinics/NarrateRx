-- Migration 095: extend campaigns for multi-instance time-windowed planning
--
-- Phase 4 Tentpole PR A: turns the campaigns table from a goal-cluster
-- tagger into a real multi-campaign planner.
--
-- Fields added:
--   start_at        — when this campaign starts being "active." NULL = active
--                     immediately (evergreen).
--   end_at          — when it stops. NULL = no end (evergreen).
--   event_at        — the specific event date this campaign drives toward
--                     (seminar date, party date). NULL for evergreen campaigns
--                     with no single anchor moment. Used by the slate biaser
--                     to weight campaign urgency.
--   theme_notes     — what the campaign is about. Will be injected into
--                     slate generator + atom prompts in PR B. Freeform text.
--   content_style   — drives content tone:
--                       'clinical'      — standard clinical content (default)
--                       'promotional'   — event registration push
--                       'relationship'  — community/retention; suppresses
--                                         clinical topic gaps in the slate
--                                         allocation for this campaign
--   cta_url, cta_label, cta_pitch — structured CTA fields (mirror
--                                   clinic_settings.campaign_cta_*).

ALTER TABLE public.campaigns
  ADD COLUMN IF NOT EXISTS start_at      timestamptz,
  ADD COLUMN IF NOT EXISTS end_at        timestamptz,
  ADD COLUMN IF NOT EXISTS event_at      timestamptz,
  ADD COLUMN IF NOT EXISTS theme_notes   text,
  ADD COLUMN IF NOT EXISTS content_style text NOT NULL DEFAULT 'clinical',
  ADD COLUMN IF NOT EXISTS cta_url       text,
  ADD COLUMN IF NOT EXISTS cta_label     text,
  ADD COLUMN IF NOT EXISTS cta_pitch     text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'campaigns_content_style_check'
  ) THEN
    ALTER TABLE public.campaigns
      ADD CONSTRAINT campaigns_content_style_check
      CHECK (content_style IN ('clinical', 'promotional', 'relationship'));
  END IF;
END$$;

-- Partial index over the active-window date range. Used by the slate generator
-- to find currently-active campaigns at request time without scanning the
-- whole table per workspace. The WHERE clause keeps the index small.
CREATE INDEX IF NOT EXISTS campaigns_active_window_idx
  ON public.campaigns (workspace_id, start_at, end_at)
  WHERE status = 'active';

-- campaigns is already granted to service_role.
