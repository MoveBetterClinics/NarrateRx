-- NarrateRx multi-tenant shared database — initial schema.
--
-- This migration runs against the new shared Supabase project ONLY.
-- Do NOT run it against any of the existing per-brand DBs. Those are
-- frozen on supabase/migrations/000-011 and will be decommissioned at
-- the end of Phase 2 cutover.
--
-- Every domain table carries workspace_id from day 1. There is no
-- backfill of an existing shared DB because there is none — this is
-- the first migration that creates it.

create extension if not exists "pgcrypto";

-- Shared updated_at trigger function (mirrors per-brand DB convention).
create or replace function update_updated_at_column()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

-- =============================================================================
-- Workspaces — one row per tenant (Move Better's three brands seed first;
-- external customers sign up later via the Phase 3 onboarding flow).
-- =============================================================================
create table workspaces (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,                 -- subdomain: <slug>.narraterx.ai

  -- Identity (tenant-editable in Phase 1 settings UI)
  display_name text not null,                -- "Move Better" / "Acme Chiropractic"
  legal_name text,
  app_name text,                             -- "Move Better — NarrateRx"
  tagline text,
  sign_in_blurb text,
  auth_domain text,                          -- email domain for org-bound sign-in

  -- Web presence
  website text,
  website_hostname text,
  location text,
  region text,
  region_short text,

  -- Visual identity
  logo jsonb default '{}'::jsonb,            -- { main, icon }
  colors jsonb default '{}'::jsonb,          -- { primary, grey, ... }
  social_avatar_initials text,
  link_preview_blurb text,
  linkedin_industry text,
  social jsonb default '{}'::jsonb,          -- { instagram, facebook, ... }

  -- Prompt context — the AI seasoning the tenant owns.
  clinic_context text,
  audience_description text,
  audience_short text,
  brand_voice text,
  internal_links_markdown text,
  booking_url text,
  signature_system_name text,
  signature_system_url text,
  pinterest_boards text,
  location_keyword text,
  location_hashtag text,
  brand_hashtag text,
  spoken_url text,
  sport_context text,

  -- Newsletter
  newsletter_template_name text,
  newsletter_copy_header text,

  -- Capabilities (developer-defined keys, tenant-editable values).
  capabilities jsonb default '{}'::jsonb,    -- { websitePublish: bool, ... }

  -- Output gate (the question that started this whole pivot).
  enabled_outputs text[] default array[]::text[],

  -- Clerk Organizations binding (set during Phase 0 / migration; one Clerk
  -- org per workspace; users are members of the org).
  clerk_org_id text unique,

  -- Lifecycle
  status text not null default 'active'
    check (status in ('active','suspended','archived')),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index workspaces_status_idx on workspaces(status);
create trigger update_workspaces_updated_at
  before update on workspaces
  for each row execute function update_updated_at_column();

-- =============================================================================
-- Workspace credentials — per-tenant API keys for external services
-- (TDC, GBP, Astro+GitHub, WordPress, OpenAI overrides, etc.). Replaces the
-- env-var-per-Vercel-project pattern. Secrets encrypted at rest with pgcrypto.
-- =============================================================================
create table workspace_credentials (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  service text not null,                      -- 'tdc' | 'gbp' | 'astro_github' | 'wordpress' | 'openai' | ...
  config jsonb default '{}'::jsonb,           -- non-secret fields (account IDs, hostnames, region, etc.)
  secret_encrypted bytea,                     -- pgcrypto-encrypted blob (token / API key / refresh token bundle)
  status text not null default 'active'
    check (status in ('active','disabled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, service)
);
create index workspace_credentials_workspace_idx on workspace_credentials(workspace_id);
create trigger update_workspace_credentials_updated_at
  before update on workspace_credentials
  for each row execute function update_updated_at_column();

-- =============================================================================
-- Domain tables — every one carries workspace_id. Indexes are workspace-first
-- since every query filters by tenant before anything else.
-- =============================================================================

-- clinicians ------------------------------------------------------------------
create table clinicians (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  name text not null,
  created_by_id text,
  created_by_email text,
  created_at timestamptz not null default now()
);
create index clinicians_workspace_idx on clinicians(workspace_id);
create index clinicians_workspace_name_idx on clinicians(workspace_id, name);
create index clinicians_workspace_creator_idx on clinicians(workspace_id, created_by_id);

-- interviews ------------------------------------------------------------------
create table interviews (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  clinician_id uuid references clinicians(id) on delete cascade,
  topic text,
  status text default 'in_progress',
  messages jsonb default '[]'::jsonb,
  outputs jsonb,
  owner_id text,
  owner_email text,
  tone text default 'smart',
  voice_mode text default 'practice',
  prototype_id text default null,
  -- Interview-layer output gate (subset of workspace.enabled_outputs).
  -- NULL = "use workspace defaults at generation time"; explicit array = "this
  -- subset only". UI pre-checks all enabled outputs at interview creation.
  selected_outputs text[] default null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index interviews_workspace_idx on interviews(workspace_id);
create index interviews_workspace_clinician_idx on interviews(workspace_id, clinician_id);
create index interviews_workspace_status_idx on interviews(workspace_id, status);
create index interviews_workspace_topic_idx on interviews(workspace_id, topic);
create index interviews_workspace_owner_idx on interviews(workspace_id, owner_id);
create trigger update_interviews_updated_at
  before update on interviews
  for each row execute function update_updated_at_column();

-- clinic_settings -------------------------------------------------------------
-- One row per workspace (was global per-DB before). workspace_id is the PK.
create table clinic_settings (
  workspace_id uuid primary key references workspaces(id) on delete cascade,
  campaign_mode text,
  campaign_notes text,
  updated_at timestamptz not null default now(),
  updated_by text
);

-- content_items ---------------------------------------------------------------
create table content_items (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  interview_id uuid references interviews(id) on delete cascade,
  clinician_id uuid references clinicians(id) on delete cascade,
  clinician_name text,
  topic text,
  platform text not null,
  content text not null,
  status text default 'draft',
  scheduled_at timestamptz,
  published_at timestamptz,
  media_urls jsonb default '[]'::jsonb,
  platform_post_id text,
  buffer_update_id text,
  reviewed_by text,
  approved_by text,
  notes text,
  target_locations jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index content_items_workspace_idx on content_items(workspace_id);
create index content_items_workspace_status_idx on content_items(workspace_id, status);
create index content_items_workspace_platform_idx on content_items(workspace_id, platform);
create index content_items_workspace_interview_idx on content_items(workspace_id, interview_id);
create index content_items_workspace_scheduled_idx on content_items(workspace_id, scheduled_at);
create trigger update_content_items_updated_at
  before update on content_items
  for each row execute function update_updated_at_column();

-- media_assets (replaces brand text column with workspace_id uuid FK) --------
create table media_assets (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  kind text not null check (kind in ('video','photo')),
  status text default 'raw',
  source text default 'upload',
  blob_url text,
  blob_pathname text,
  rendered_url text,
  drive_id text,
  filename text,
  mime_type text,
  size_bytes bigint,
  duration_s numeric,
  aspect_ratio text,
  width integer,
  height integer,
  thumbnail_url text,
  patient_pseudonym text,
  condition text,
  captured_at timestamptz,
  tags jsonb default '[]'::jsonb,
  ai_tags jsonb default '[]'::jsonb,
  transcription text,
  visual_narrative text,
  speaker_role text default 'clinician'
    check (speaker_role in ('clinician','admin','patient_guest')),
  notes text,
  content_item_ids jsonb default '[]'::jsonb,
  parent_id uuid references media_assets(id) on delete cascade,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by text
);
create index media_assets_workspace_idx on media_assets(workspace_id);
create index media_assets_workspace_status_idx on media_assets(workspace_id, status);
create index media_assets_workspace_kind_idx on media_assets(workspace_id, kind);
create index media_assets_workspace_created_idx on media_assets(workspace_id, created_at desc);
create index media_assets_workspace_captured_idx on media_assets(workspace_id, captured_at desc);
create index media_assets_parent_idx on media_assets(parent_id);
create index media_assets_archived_idx on media_assets(archived_at) where archived_at is not null;
create trigger update_media_assets_updated_at
  before update on media_assets
  for each row execute function update_updated_at_column();

-- content_pieces (replaces brand text column with workspace_id uuid FK) ------
create table content_pieces (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  source_asset_id uuid not null references media_assets(id) on delete cascade,
  source_trim_start numeric,
  source_trim_end numeric,
  source_quote text,
  ai_suggested_platform text,
  ai_caption text,
  ai_hashtags jsonb default '[]'::jsonb,
  ai_cta_text text,
  ai_reasoning text,
  ai_model text,
  ai_generated_at timestamptz,
  final_caption text,
  final_hashtags jsonb,
  final_cta_text text,
  final_cta_url text,
  target_platform text,
  final_asset_id uuid references media_assets(id) on delete set null,
  status text default 'suggested',
  assigned_to text,
  notes text,
  rejected_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  accepted_at timestamptz,
  returned_at timestamptz,
  published_at timestamptz,
  published_target_id text
);
create index content_pieces_workspace_status_idx on content_pieces(workspace_id, status);
create index content_pieces_source_asset_idx on content_pieces(source_asset_id);
create index content_pieces_workspace_created_idx on content_pieces(workspace_id, created_at desc);
create index content_pieces_assigned_idx on content_pieces(assigned_to, status)
  where assigned_to is not null;
create trigger update_content_pieces_updated_at
  before update on content_pieces
  for each row execute function update_updated_at_column();

-- media_audit (replaces brand text column with workspace_id uuid FK) ---------
create table media_audit (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  asset_id uuid,                              -- soft FK; assets may be hard-deleted
  action text not null,
  actor text,                                 -- Clerk user ID or 'system'
  before jsonb,
  after jsonb,
  ip text,
  user_agent text,
  created_at timestamptz not null default now()
);
create index media_audit_workspace_idx on media_audit(workspace_id);
create index media_audit_asset_idx on media_audit(asset_id);
create index media_audit_actor_idx on media_audit(actor);
create index media_audit_action_idx on media_audit(action);
create index media_audit_created_idx on media_audit(created_at desc);

-- collections (replaces brand text column with workspace_id uuid FK) ---------
create table collections (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  name text not null,
  slug text,
  description text,
  kind text default 'campaign',
  cover_asset_id uuid references media_assets(id) on delete set null,
  status text default 'active' check (status in ('active','archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by text,
  unique (workspace_id, slug)
);
create index collections_workspace_status_idx on collections(workspace_id, status);
create index collections_workspace_name_idx on collections(workspace_id, name);
create trigger update_collections_updated_at
  before update on collections
  for each row execute function update_updated_at_column();

-- collection_items (junction; tenant scope inherited via collection FK) ------
create table collection_items (
  collection_id uuid not null references collections(id) on delete cascade,
  asset_id uuid not null references media_assets(id) on delete cascade,
  position integer,
  added_at timestamptz not null default now(),
  added_by text,
  primary key (collection_id, asset_id)
);
create index collection_items_asset_idx on collection_items(asset_id);
