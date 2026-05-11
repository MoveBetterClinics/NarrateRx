-- Route Google Business Profile through Buffer.
--
-- Background: PR #194 retired direct Facebook publishing in favor of Buffer
-- but explicitly scoped GBP out because of the multi-location architecture.
-- This migration completes that work. NarrateRx no longer holds GCP service
-- account creds; instead each GBP listing is connected as a Buffer channel
-- and identified per-location by workspace_locations.gbp_location_id (which
-- now stores the Buffer profile ID rather than the legacy `locations/<id>`
-- Google Business ID).
--
-- This migration only updates metadata. It does NOT delete dormant
-- workspace_credentials rows for service='gbp' — those stay in place as a
-- belt-and-suspenders rollback hatch and can be cleaned up later.

comment on column workspace_locations.gbp_location_id is
  'Buffer GBP profile ID for this physical location (was Google `locations/<id>` before 2026-05-11). Resolved at publish time by api/publish/buffer.js when platform=gbp.';

-- Clear stale Google IDs seeded by 010_workspace_locations.sql so the Workspace
-- Settings → Locations panel prompts admins to paste the Buffer channel ID.
-- Anything that already looks like a Buffer profile ID (no `locations/` prefix)
-- is left alone, so this is safe to re-run.
update workspace_locations
   set gbp_location_id = null
 where gbp_location_id like 'locations/%';
