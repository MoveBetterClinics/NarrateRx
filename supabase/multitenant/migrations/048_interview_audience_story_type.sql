-- Phase 2 of pre-interview controls — capture the audience and story-type
-- selections made on the New Interview form on the interview row itself.
--
-- Stored as the slot KEY (not the display label) so workspace admins can
-- rename labels after the fact without corrupting old interview records.
-- Prompt-building code resolves key → label at generation time by looking
-- up the workspace's current audience_options / story_type_options arrays.
--
-- Both columns are nullable: interviews created before this migration, or
-- created on workspaces that haven't configured any slots, simply have NULL.

alter table public.interviews
  add column if not exists audience   text,
  add column if not exists story_type text;

grant select, insert, update, delete on public.interviews to service_role;
