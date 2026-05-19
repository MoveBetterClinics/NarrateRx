-- Length preset for long-form content (blog, newsletter). Controls target word
-- count and voice-fidelity instructions in the generation prompt.
--
-- preferred_length on clinicians     → per-clinician default (NULL = 'standard')
-- length_preset    on content_items  → per-piece override (NULL = inherit
--                                       clinician default → 'standard')
--
-- Allowed values: 'tight' | 'standard' | 'expansive'
--   tight     ~450–650 words   — lean, fewer expanded sections
--   standard  ~700–950 words   — current default (unchanged behavior)
--   expansive ~1300–1800 words — voice-faithful, leans on clinician phrasing
--
-- Only consulted by long-form generators today (blog; newsletter is queued for
-- a follow-up that adds standalone email regeneration).

alter table public.clinicians
  add column if not exists preferred_length text;

alter table public.content_items
  add column if not exists length_preset text;

grant select, insert, update, delete on public.clinicians   to service_role;
grant select, insert, update, delete on public.content_items to service_role;
