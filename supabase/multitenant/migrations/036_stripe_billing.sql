-- 036_stripe_billing.sql
-- Adds Stripe billing columns to the workspaces table.
-- Applied 2026-05-14 via apply-multitenant-migrations.mjs (already applied
-- inline during feature development; this file is the canonical record).
--
-- plan and trial_ends_at already existed from 035_trial_onboarding.sql.

ALTER TABLE public.workspaces
  ADD COLUMN IF NOT EXISTS stripe_customer_id      text,
  ADD COLUMN IF NOT EXISTS stripe_subscription_id  text,
  ADD COLUMN IF NOT EXISTS stripe_price_id         text,
  ADD COLUMN IF NOT EXISTS plan_seats              int NOT NULL DEFAULT 3;

-- No GRANT needed — service_role already has full access to workspaces
-- from 003_grant_service_role.sql which covers all existing tables.
