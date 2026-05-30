-- Migration 107: per-staff capability overrides
--
-- Adds a jsonb column to the staff table so individual staff members can
-- receive custom grants/revocations on top of their permission_tier template.
-- This is the third resolution layer:
--
--   DEFAULT_TEMPLATES[tier]            (code, api/_lib/capabilities.js)
--     + workspaces.role_templates[tier] (migration 092)
--       + staff.capability_overrides     (this migration)
--
-- Schema: { [capId]: boolean }
--   true  = explicit grant  (tier default was off, person gets on)
--   false = explicit revoke (tier default was on,  person gets off)
--   absent key = inherit from tier/workspace template
--
-- Constraints (enforced at the API layer, not the DB):
--   * Owner-tier staff rows are always all-caps; overrides are ignored + rejected.
--   * Only the 14 known capability IDs are valid keys.
--   * Owner-only caps (settings.*, billing.*, members.invite) cannot be set
--     true for non-owner staff rows.

ALTER TABLE public.staff
  ADD COLUMN IF NOT EXISTS capability_overrides jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.staff.capability_overrides IS
  'Per-person capability delta. Keys are cap IDs (see api/_lib/capabilities.js ALL_CAPABILITIES). '
  'true = explicit grant above tier default, false = explicit revoke, {} = pure tier default.';

-- staff already has SELECT/INSERT/UPDATE/DELETE granted to service_role from
-- migration 106 (the rename carried grants forward). Adding a column does not
-- require re-granting table privileges, but we re-assert here so this migration
-- is self-sufficient per the project's migration convention.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.staff TO service_role;
