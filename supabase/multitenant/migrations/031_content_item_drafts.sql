-- Draft history for content_items.
--
-- Every time an AI redraft is applied (in whole or in part) to a
-- content_item, we snapshot the pre-apply body into this table so the
-- editor has an audit trail and can revert to any earlier version.
-- Also doubles as the source-of-truth for the redraft diff view:
-- comparison is between the latest persisted draft and the proposed
-- AI redraft (which is held in component state until accepted).
--
-- The table is intentionally append-only from the app — trimming to
-- the latest N is handled by the API handler (DELETE older than the
-- 5th most-recent) rather than via triggers, so the contract is
-- explicit and visible at the call site.
--
-- ai_generated tracks whether the snapshot came from an AI redraft
-- (true) or a manual editor save (false). Lets the UI label history
-- entries differently and lets future analyses isolate AI provenance.

create table if not exists public.content_item_drafts (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null references public.workspaces(id) on delete cascade,
  content_item_id uuid not null references public.content_items(id) on delete cascade,
  body            text not null,
  ai_generated    boolean not null default false,
  created_at      timestamptz not null default now()
);

create index if not exists content_item_drafts_item_idx
  on public.content_item_drafts (content_item_id, created_at desc);

create index if not exists content_item_drafts_workspace_idx
  on public.content_item_drafts (workspace_id);

-- The REST API used by serverless functions runs as service_role. New
-- tables don't inherit the broad GRANTs from earlier migrations, so the
-- explicit grant block is required here per the project's migration
-- convention (CLAUDE.md → Supabase migrations).
grant select, insert, update, delete on public.content_item_drafts to service_role;
grant usage on all sequences in schema public to service_role;
