-- Per-clinician interview recipe — saved default pre-interview selections that
-- auto-fill the New Interview form when a clinician is chosen. Each field
-- stores a key (not a display label) so workspace-level label renames don't
-- corrupt stored recipes. All columns are nullable: NULL means "no saved
-- default for this field."
--
-- default_audience   → key from workspaces.audience_options
-- default_story_type → key from workspaces.story_type_options
-- default_tone       → 'smart' | 'active' | 'clinical' | 'warm'
-- default_voice_mode → 'practice' | 'personal'

alter table public.clinicians
  add column if not exists default_audience   text,
  add column if not exists default_story_type text,
  add column if not exists default_tone       text,
  add column if not exists default_voice_mode text;

grant select, insert, update, delete on public.clinicians to service_role;
