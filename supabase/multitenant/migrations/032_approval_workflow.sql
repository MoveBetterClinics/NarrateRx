-- Approval workflow: comments table + approval timestamp + workspace skip toggle.
--
-- Before this migration, content_items.status already supported the
-- 'in_review' and 'approved' states — they just weren't gated. Now we
-- add an explicit timestamp for when approval happened (the existing
-- approved_by tracks who, never when) plus a comments thread per item
-- so reviewers can leave change requests inline.
--
-- workspaces.skip_review is the per-tenant escape hatch for single-user
-- workspaces: when true, the "Send for review" path is hidden and the
-- editor can publish directly without an approval step. Default false
-- in this migration; the wizard / settings UI sets it explicitly at
-- workspace creation.

alter table public.content_items
  add column if not exists approved_at timestamptz;

alter table public.workspaces
  add column if not exists skip_review boolean not null default false;

create table if not exists public.content_item_comments (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null references public.workspaces(id) on delete cascade,
  content_item_id uuid not null references public.content_items(id) on delete cascade,
  user_id         text not null,
  user_email      text,
  body            text not null,
  -- 'comment' for a plain note, 'change_request' for the Request Changes
  -- action so the UI can render them differently. Anything else is a
  -- forward-compatibility slot.
  kind            text not null default 'comment',
  created_at      timestamptz not null default now()
);

create index if not exists content_item_comments_item_idx
  on public.content_item_comments (content_item_id, created_at asc);

create index if not exists content_item_comments_workspace_idx
  on public.content_item_comments (workspace_id);

grant select, insert, update, delete on public.content_item_comments to service_role;
grant usage on all sequences in schema public to service_role;
