-- Brand Kit — library of brand assets + named-role assignments + style.
--
-- Two new tables:
--   brand_assets       — every uploaded file (logo variant, brand book PDF, etc.)
--                        with auto-classified shape / background / color_mode +
--                        filename token list and ranked role candidates.
--   brand_kit_roles    — sparse mapping of role-name → asset_id per workspace.
--                        Downstream channels (email, social, site) resolve assets
--                        by role name, not by id, so swapping the underlying file
--                        doesn't require rewiring publishers.
--
-- Plus a brand_style jsonb column on workspaces for non-file brand state
-- (accent color, secondary palette, heading/body font names).
--
-- Note the explicit GRANT block at the bottom — the REST API runs as
-- service_role and returns 403/42501 on unprivileged objects (see CLAUDE.md
-- "Supabase migrations" — this is a hard project rule, not optional).

-- ===========================================================================
-- brand_assets
-- ===========================================================================
create table if not exists public.brand_assets (
  id                uuid primary key default gen_random_uuid(),
  workspace_id      uuid not null references public.workspaces(id) on delete cascade,

  -- Blob storage refs. The pathname is what we use to delete; the URL is what
  -- callers render. Same shape the media table uses.
  blob_url          text not null,
  blob_pathname     text not null,
  mime_type         text not null,
  byte_size         bigint not null,
  original_filename text not null,

  -- Raster/vector intrinsic shape, populated at upload time by sharp + PDF
  -- handler. Null where the format doesn't carry the concept (e.g. PDF has
  -- no single shape).
  width             int,
  height            int,
  has_alpha         boolean,

  -- Bucketed shape from aspect ratio + dimensions. icon = small square.
  shape             text check (shape in ('horizontal','vertical','square','icon')),

  -- Inferred from corner-pixel luminance / alpha dominance.
  background        text check (background in ('light','dark','transparent','unknown')),

  -- Inferred from dominant-color analysis.
  color_mode        text check (color_mode in ('color','mono_black','mono_white','unknown')),

  -- Parsed from original_filename against a fixed vocabulary
  -- (horizontal, vertical, icon, mark, wordmark, primary, light, dark,
  -- reversed, knockout, white, black, color, mono, favicon, social, avatar,
  -- cover, rgb, cmyk, etc.).
  filename_tokens   text[] not null default '{}',

  -- Server-computed at upload, refreshed on metadata changes.
  -- Shape: { role_candidates: [{ role: 'primary_logo', confidence: 0.9 }, ...] }
  ai_classification jsonb,

  -- User-editable free-form tags. Surfaced in the Library filter bar.
  user_tags         text[] not null default '{}',

  uploaded_by       uuid,
  uploaded_at       timestamptz not null default now()
);

create index if not exists brand_assets_workspace_idx
  on public.brand_assets (workspace_id, uploaded_at desc);

-- ===========================================================================
-- brand_kit_roles
-- ===========================================================================
-- Role names live in the application as a known enum-by-convention rather than
-- a Postgres enum type, because new channels (e.g. a future "podcast_artwork"
-- slot) will land without a migration. The composite primary key enforces
-- one-asset-per-role-per-workspace; downstream code reads via
-- `select role, asset_id from brand_kit_roles where workspace_id = $1`.
create table if not exists public.brand_kit_roles (
  workspace_id      uuid not null references public.workspaces(id) on delete cascade,
  role              text not null,
  asset_id          uuid not null references public.brand_assets(id) on delete restrict,
  assigned_by       uuid,
  assigned_at       timestamptz not null default now(),
  primary key (workspace_id, role)
);

create index if not exists brand_kit_roles_asset_idx
  on public.brand_kit_roles (asset_id);

-- ===========================================================================
-- workspaces.brand_style
-- ===========================================================================
-- Non-file brand state. Shape:
--   { accent_color: '#0a7f3f',
--     secondary_colors: ['#1e40af','#f59e0b'],
--     heading_font: 'Inter',
--     body_font: 'Source Sans 3' }
-- The rendering layer (email template, Astro publish, social card defaults)
-- honors these where the channel supports them and falls back to system
-- defaults otherwise.
alter table public.workspaces
  add column if not exists brand_style jsonb not null default '{}'::jsonb;

-- ===========================================================================
-- Grants — required for service_role to read/write via PostgREST.
-- ===========================================================================
grant select, insert, update, delete on public.brand_assets    to service_role;
grant select, insert, update, delete on public.brand_kit_roles to service_role;
grant usage on all sequences in schema public to service_role;
