-- One-time data migration: singleton campaign-mode → tentpole campaigns
--
-- Run AFTER migration 097 (referral content_style enum) is applied, BEFORE
-- migration 098 (drops the singleton columns).
--
-- For each workspace with clinic_settings.campaign_mode in ('seminars',
-- 'referrals') AND any meaningful data set, creates ONE tentpole campaign
-- row carrying the migrated values. Same for any clinicians with a non-null
-- clinicians.campaign_settings JSONB override.
--
-- Idempotent: matches on the literal name prefix 'Migrated from singleton — '
-- so re-running this is a no-op.
--
-- Paste into Supabase SQL Editor:
--   https://supabase.com/dashboard/project/wrqfrjhevkbbheymzezy/sql/new
--
-- After running, eyeball the inserted rows in /settings/campaigns on each
-- live workspace and adjust event dates / theme notes as needed.

-- 1. Workspace-level (clinic_settings) — seminars mode
INSERT INTO public.campaigns (
  workspace_id, name, description, status, content_style,
  theme_notes, event_at, cta_url, cta_label, cta_pitch,
  start_at, created_by
)
SELECT
  cs.workspace_id,
  'Migrated from singleton — seminars' AS name,
  'Auto-created from clinic_settings.campaign_mode = ''seminars'' during the singleton-retirement migration. Edit at /settings/campaigns.' AS description,
  'active' AS status,
  'promotional' AS content_style,
  NULLIF(cs.campaign_notes, '') AS theme_notes,
  cs.campaign_event_at AS event_at,
  NULLIF(cs.campaign_cta_url, '') AS cta_url,
  NULLIF(cs.campaign_cta_label, '') AS cta_label,
  NULLIF(cs.campaign_cta_pitch, '') AS cta_pitch,
  NOW() AS start_at,
  'migration:singleton-to-tentpole' AS created_by
FROM public.clinic_settings cs
WHERE cs.campaign_mode = 'seminars'
  AND NOT EXISTS (
    SELECT 1 FROM public.campaigns c
     WHERE c.workspace_id = cs.workspace_id
       AND c.name LIKE 'Migrated from singleton — %'
  );

-- 2. Workspace-level (clinic_settings) — referrals mode
INSERT INTO public.campaigns (
  workspace_id, name, description, status, content_style,
  theme_notes, cta_url, cta_label, cta_pitch,
  start_at, created_by
)
SELECT
  cs.workspace_id,
  'Migrated from singleton — referrals' AS name,
  'Auto-created from clinic_settings.campaign_mode = ''referrals'' during the singleton-retirement migration. Edit at /settings/campaigns.' AS description,
  'active' AS status,
  'referral' AS content_style,
  NULLIF(cs.campaign_notes, '') AS theme_notes,
  NULLIF(cs.campaign_cta_url, '') AS cta_url,
  NULLIF(cs.campaign_cta_label, '') AS cta_label,
  NULLIF(cs.campaign_cta_pitch, '') AS cta_pitch,
  NOW() AS start_at,
  'migration:singleton-to-tentpole' AS created_by
FROM public.clinic_settings cs
WHERE cs.campaign_mode = 'referrals'
  AND NOT EXISTS (
    SELECT 1 FROM public.campaigns c
     WHERE c.workspace_id = cs.workspace_id
       AND c.name LIKE 'Migrated from singleton — referrals%'
  );

-- 3. Per-clinician overrides (clinicians.campaign_settings JSONB)
-- Each clinician with a non-null override gets ONE tentpole campaign carrying
-- their JSONB values + target_clinician_ids set to themselves.
-- The JSONB shape from campaignSettings.js:
--   { mode, notes, cta_url, cta_label, cta_pitch, event_at }
-- We only migrate seminars/referrals overrides — bookings = no-op.
INSERT INTO public.campaigns (
  workspace_id, name, description, status, content_style,
  theme_notes, event_at, cta_url, cta_label, cta_pitch,
  target_clinician_ids, start_at, created_by
)
SELECT
  cl.workspace_id,
  'Migrated from singleton — ' || COALESCE(cl.name, 'clinician') || ' (' || (cl.campaign_settings->>'mode') || ')' AS name,
  'Auto-created from clinicians.campaign_settings during the singleton-retirement migration. Originally a per-clinician override. Edit at /settings/campaigns.' AS description,
  'active' AS status,
  CASE (cl.campaign_settings->>'mode')
    WHEN 'seminars'  THEN 'promotional'
    WHEN 'referrals' THEN 'referral'
    ELSE 'clinical'
  END AS content_style,
  NULLIF(cl.campaign_settings->>'notes', '') AS theme_notes,
  CASE
    WHEN cl.campaign_settings->>'event_at' IS NOT NULL
     AND cl.campaign_settings->>'event_at' <> ''
    THEN (cl.campaign_settings->>'event_at')::timestamptz
    ELSE NULL
  END AS event_at,
  NULLIF(cl.campaign_settings->>'cta_url', '')   AS cta_url,
  NULLIF(cl.campaign_settings->>'cta_label', '') AS cta_label,
  NULLIF(cl.campaign_settings->>'cta_pitch', '') AS cta_pitch,
  ARRAY[cl.id]::uuid[] AS target_clinician_ids,
  NOW() AS start_at,
  'migration:singleton-to-tentpole' AS created_by
FROM public.clinicians cl
WHERE cl.campaign_settings IS NOT NULL
  AND (cl.campaign_settings->>'mode') IN ('seminars', 'referrals')
  AND NOT EXISTS (
    SELECT 1 FROM public.campaigns c
     WHERE c.workspace_id = cl.workspace_id
       AND c.target_clinician_ids @> ARRAY[cl.id]::uuid[]
       AND c.name LIKE 'Migrated from singleton — %'
  );

-- Audit: show what got created.
SELECT
  COUNT(*) FILTER (WHERE content_style = 'promotional') AS migrated_seminars,
  COUNT(*) FILTER (WHERE content_style = 'referral')    AS migrated_referrals,
  COUNT(*) FILTER (WHERE target_clinician_ids <> '{}')  AS per_clinician_overrides,
  COUNT(*) AS total
FROM public.campaigns
WHERE name LIKE 'Migrated from singleton — %';
