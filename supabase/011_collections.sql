-- Collections — editorial groupings of media_assets.
-- Run this in your Supabase SQL Editor on EACH brand's Supabase instance
-- (people, equine, animals). Supabase Dashboard → SQL Editor → New Query.
--
-- A collection is a many-to-many bundle of media_assets that share an
-- editorial theme — a campaign, a series, a session, an ad-hoc grouping.
-- Tags describe properties of one asset; collections describe groupings of
-- many. The two compose: filter "tag:knee + collection:May-Campaign" answers
-- "what knee assets are in May campaign?".

CREATE TABLE IF NOT EXISTS collections (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  brand           TEXT NOT NULL,                  -- 'people' | 'equine' | 'animals'
  name            TEXT NOT NULL,
  slug            TEXT,                           -- url-safe; unique per brand when set
  description     TEXT,
  kind            TEXT NOT NULL DEFAULT 'campaign', -- campaign | series | session | adhoc
  cover_asset_id  UUID REFERENCES media_assets(id) ON DELETE SET NULL,
  status          TEXT NOT NULL DEFAULT 'active', -- active | archived
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by      TEXT,                           -- Clerk user id
  UNIQUE (brand, slug)
);

CREATE INDEX IF NOT EXISTS collections_brand_status_idx ON collections(brand, status);
CREATE INDEX IF NOT EXISTS collections_brand_name_idx   ON collections(brand, name);

DROP TRIGGER IF EXISTS update_collections_updated_at ON collections;
CREATE TRIGGER update_collections_updated_at
  BEFORE UPDATE ON collections
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Junction. Composite primary key (collection_id, asset_id) prevents an asset
-- from being added to the same collection twice. Cascade deletes mean
-- removing a collection drops its memberships but leaves assets intact.
-- Removing an asset (which itself cascades parent_id chains) drops its
-- memberships across every collection.
CREATE TABLE IF NOT EXISTS collection_items (
  collection_id   UUID NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  asset_id        UUID NOT NULL REFERENCES media_assets(id) ON DELETE CASCADE,
  position        INTEGER,                        -- NULL = unordered; smaller = earlier
  added_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  added_by        TEXT,
  PRIMARY KEY (collection_id, asset_id)
);

CREATE INDEX IF NOT EXISTS collection_items_asset_idx ON collection_items(asset_id);
