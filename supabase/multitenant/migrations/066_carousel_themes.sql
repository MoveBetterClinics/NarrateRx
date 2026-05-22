-- Carousel themes — per-workspace custom text-overlay style sets.
-- Built-in themes ship in code (src/lib/carouselThemes.js); this table stores
-- workspace-specific overrides. One row can be marked is_default; the unique
-- partial index enforces at most one default per workspace.

CREATE TABLE public.workspace_carousel_themes (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid        NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name         text        NOT NULL,
  is_default   boolean     NOT NULL DEFAULT false,
  -- config JSONB shape:
  -- { blocks: { hook|body|caption|cta|attribution|page: {
  --     fontSize, fontWeight, color, shadow, background, bgColor, uppercase
  --   } } }
  config       jsonb       NOT NULL DEFAULT '{}',
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

-- Only one default theme allowed per workspace
CREATE UNIQUE INDEX uq_one_carousel_default_per_workspace
  ON public.workspace_carousel_themes (workspace_id)
  WHERE is_default = true;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.workspace_carousel_themes TO service_role;

-- Store the active theme on each carousel story.
-- NULL = fall back to workspace default (or 'bold-dark' built-in).
-- Value is either a built-in slug ('bold-dark', 'warm-light', etc.)
-- or a UUID from workspace_carousel_themes.
ALTER TABLE public.content_items
  ADD COLUMN IF NOT EXISTS carousel_theme_id text DEFAULT NULL;
