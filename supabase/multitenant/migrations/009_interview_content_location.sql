-- PR B — per-post location_id on interviews and content_items.
--
-- An interview targets a specific workspace_location (or null = "all
-- locations" / use workspace umbrella). content_items inherit it from the
-- interview when auto-created, so prompts and GBP publishing pick up the
-- right per-location vars without per-row re-tagging.
--
-- ON DELETE SET NULL: archiving a location shouldn't cascade-delete past
-- interviews/posts. They simply fall back to the workspace umbrella.

alter table interviews
  add column if not exists location_id uuid
    references workspace_locations(id) on delete set null;

alter table content_items
  add column if not exists location_id uuid
    references workspace_locations(id) on delete set null;

create index if not exists interviews_workspace_location_idx
  on interviews(workspace_id, location_id);
create index if not exists content_items_workspace_location_idx
  on content_items(workspace_id, location_id);
