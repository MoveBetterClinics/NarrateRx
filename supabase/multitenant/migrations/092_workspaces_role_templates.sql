-- Migration 092: workspaces.role_templates
--
-- Phase 4 PR 2: per-workspace permission template overrides.
--
-- Stores partial overrides of the default role templates defined in code
-- (api/_lib/capabilities.js → DEFAULT_TEMPLATES). When null, the workspace
-- uses the code defaults wholesale. When set, the JSONB merges per-tier:
-- missing tiers fall back to defaults, listed tiers override.
--
-- Example value (Move Better's Producer near-admin override):
--   {
--     "producer": {
--       "label": "Producer",
--       "capabilities": [
--         "settings.view", "settings.edit", "billing.view",
--         "integrations.connect", "brand_kit.edit", "members.invite",
--         "interview.start", "interview.edit_others",
--         "content.approve", "content.publish",
--         "slate.generate", "slate.approve"
--       ]
--     }
--   }
--
-- The capability strings themselves are NOT validated at the DB level — code
-- (resolveCapabilities) treats unknown strings as no-ops. This lets us add
-- new capabilities in code without a schema migration.

ALTER TABLE public.workspaces
  ADD COLUMN IF NOT EXISTS role_templates jsonb;

COMMENT ON COLUMN public.workspaces.role_templates IS
  'Per-workspace overrides for permission tier capability sets. NULL = use code defaults. See api/_lib/capabilities.js → resolveTemplate().';

-- workspaces is already granted to service_role; no additional grants needed.
