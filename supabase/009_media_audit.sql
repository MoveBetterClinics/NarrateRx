-- Run this in your Supabase SQL Editor
-- Supabase Dashboard → SQL Editor → New Query → paste → Run
--
-- Run on EACH brand's Supabase instance (people, equine, animals).
--
-- Adds an append-only audit log for every mutation against media_assets.
-- The audit log is the recovery mechanism between soft-delete (Layer 1) and
-- B2 backups (Layer 4) — it tells us who did what when, so a "nothing got
-- deleted, just archived in error" incident can be reversed by inspecting
-- the log and calling restore.

CREATE TABLE IF NOT EXISTS media_audit (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  brand       TEXT NOT NULL,                 -- 'people' | 'equine' | 'animals'
  asset_id    UUID,                          -- FK-by-convention to media_assets.id; nullable so deletes still log
  action      TEXT NOT NULL,                 -- upload | edit | tag | archive | restore | purge
  actor       TEXT,                          -- Clerk user id, or 'system' for automatic actions
  before      JSONB,                         -- snapshot before the mutation (null for upload)
  after       JSONB,                         -- snapshot after the mutation (null for purge)
  ip          TEXT,                          -- request IP (best-effort, null on internal callers)
  user_agent  TEXT,                          -- best-effort
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS media_audit_brand_idx      ON media_audit(brand);
CREATE INDEX IF NOT EXISTS media_audit_asset_id_idx   ON media_audit(asset_id);
CREATE INDEX IF NOT EXISTS media_audit_actor_idx      ON media_audit(actor);
CREATE INDEX IF NOT EXISTS media_audit_action_idx     ON media_audit(action);
CREATE INDEX IF NOT EXISTS media_audit_created_at_idx ON media_audit(created_at DESC);

-- The audit log is append-only by convention; we don't grant UPDATE/DELETE
-- via RLS (when RLS is added later in Layer 2 follow-up). The service-role
-- key can still mutate it for emergency cleanup, but routine paths only INSERT.
