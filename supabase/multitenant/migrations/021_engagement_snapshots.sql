-- Tier 2 of the exemplar feedback loop: engagement metrics pulled from the
-- publishing source (initially Buffer). Each row is a point-in-time snapshot
-- — we keep history so we can show growth-over-time later and so the
-- auto-flag heuristic (Tier 2b) can look at deltas, not just absolutes.

CREATE TABLE IF NOT EXISTS public.engagement_snapshots (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    uuid        NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  content_item_id uuid        NOT NULL REFERENCES public.content_items(id) ON DELETE CASCADE,
  source          text        NOT NULL,                          -- 'buffer' | 'ga4' | …
  stats           jsonb       NOT NULL,                          -- raw provider payload, source-shaped
  fetched_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS engagement_snapshots_item_idx
  ON public.engagement_snapshots (content_item_id, fetched_at DESC);

CREATE INDEX IF NOT EXISTS engagement_snapshots_workspace_idx
  ON public.engagement_snapshots (workspace_id, fetched_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.engagement_snapshots TO service_role;
