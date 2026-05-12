import { withSentry } from '../_lib/sentry.js'
// Workspace locations endpoint.
//
//   GET                    — list locations for the active workspace (any signed-in member)
//   POST                   — create a new location (admin)
//   PATCH ?id=<uuid>       — update a location, including is_primary toggling (admin)
//   DELETE ?id=<uuid>      — archive a location (admin); blocked for the primary
//
// On any write that creates/updates the row marked is_primary=true, the
// endpoint mirrors the primary's city/region/keyword/hashtag back onto
// workspaces.location / location_keyword / location_hashtag so existing
// prompts keep rendering identically. Without that backfill, single-location
// workspaces would lose their interpolated values.

import { workspaceContext } from '../_lib/workspaceContext.js'
import { requireRole } from '../_lib/auth.js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY

const PATCHABLE = new Set([
  'label', 'city', 'region',
  'location_keyword', 'location_hashtag',
  'visit_url', 'gbp_location_id',
  'is_primary', 'position', 'status',
])

function sb(path, init = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      ...init.headers,
    },
  })
}

function s(v, max = 200) {
  if (typeof v !== 'string') return null
  const t = v.trim()
  if (!t) return null
  return t.slice(0, max)
}

function buildPrimaryUmbrella(loc) {
  // "Portland, OR" / "Portland" if region missing.
  const city = (loc.city || '').trim()
  const region = (loc.region || '').trim()
  if (city && region) return `${city}, ${region}`
  return city || region || null
}

async function syncWorkspaceFromPrimary(workspaceId) {
  // Fetch whichever row is currently primary and copy its identity back onto
  // the workspaces row. No-op if there's no primary yet (shouldn't happen
  // after onboarding completes, but the endpoint is defensive).
  const r = await sb(
    `workspace_locations?workspace_id=eq.${encodeURIComponent(workspaceId)}&is_primary=eq.true&select=*&limit=1`
  )
  if (!r.ok) return
  const rows = await r.json().catch(() => null)
  const primary = Array.isArray(rows) ? rows[0] : null
  if (!primary) return

  const patch = {
    location: buildPrimaryUmbrella(primary),
    location_keyword: primary.location_keyword || null,
    location_hashtag: primary.location_hashtag || null,
  }
  await sb(`workspaces?id=eq.${encodeURIComponent(workspaceId)}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  })
}

async function unsetOtherPrimaries(workspaceId, exceptId) {
  // Partial unique index enforces "at most one primary"; we additionally clear
  // any prior primary so toggling is deterministic.
  const filter = exceptId
    ? `workspace_id=eq.${encodeURIComponent(workspaceId)}&id=neq.${encodeURIComponent(exceptId)}&is_primary=eq.true`
    : `workspace_id=eq.${encodeURIComponent(workspaceId)}&is_primary=eq.true`
  await sb(`workspace_locations?${filter}`, {
    method: 'PATCH',
    body: JSON.stringify({ is_primary: false }),
  })
}

async function handler(req, res) {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return res.status(500).json({ error: 'server-misconfigured' })
  }

  const workspace = await workspaceContext(req)
  if (!workspace) return res.status(404).json({ error: 'no-workspace-context' })

  // GET — readable by any signed-in member of the workspace org.
  if (req.method === 'GET') {
    const auth = await requireRole(req, null, { orgId: workspace.clerk_org_id })
    if (!auth.ok) {
      const status = auth.reason === 'forbidden' ? 403 : 401
      return res.status(status).json({ error: auth.reason })
    }
    const r = await sb(
      `workspace_locations?workspace_id=eq.${encodeURIComponent(workspace.id)}&status=eq.active&select=*&order=position.asc`
    )
    if (!r.ok) return res.status(500).json({ error: 'db-error' })
    const rows = await r.json().catch(() => [])
    res.setHeader('Cache-Control', 'private, no-store')
    return res.status(200).json({ locations: Array.isArray(rows) ? rows : [] })
  }

  // Writes require admin.
  const auth = await requireRole(req, ['admin'], { orgId: workspace.clerk_org_id })
  if (!auth.ok) {
    const status = auth.reason === 'forbidden' ? 403 : 401
    return res.status(status).json({ error: auth.reason })
  }

  if (req.method === 'POST') {
    const body = req.body || {}
    const city = s(body.city, 100)
    if (!city) return res.status(400).json({ error: 'missing-city' })
    const label = s(body.label, 100) || city
    const region = s(body.region, 50)
    const isPrimary = Boolean(body.is_primary)

    // If this is being inserted as primary, clear any existing primary first.
    if (isPrimary) await unsetOtherPrimaries(workspace.id, null)

    const insert = [{
      workspace_id: workspace.id,
      label,
      city,
      region,
      location_keyword: s(body.location_keyword, 100),
      location_hashtag: s(body.location_hashtag, 100),
      visit_url: s(body.visit_url, 500),
      gbp_location_id: s(body.gbp_location_id, 200),
      is_primary: isPrimary,
      position: Number.isFinite(body.position) ? Math.trunc(body.position) : 0,
    }]
    const r = await sb('workspace_locations', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify(insert),
    })
    if (!r.ok) {
      const text = await r.text().catch(() => '')
      console.error(`[locations POST] supabase ${r.status}:`, text)
      return res.status(500).json({ error: 'db-error' })
    }
    const rows = await r.json().catch(() => null)
    const row = Array.isArray(rows) ? rows[0] : null

    if (isPrimary) await syncWorkspaceFromPrimary(workspace.id)
    return res.status(200).json(row)
  }

  if (req.method === 'PATCH') {
    const id = req.query?.id
    if (!id) return res.status(400).json({ error: 'missing-id' })

    const body = req.body || {}
    const patch = {}
    for (const [k, v] of Object.entries(body)) {
      if (!PATCHABLE.has(k)) continue
      if (k === 'is_primary' || k === 'position') patch[k] = v
      else if (k === 'status') patch[k] = v === 'archived' ? 'archived' : 'active'
      else patch[k] = typeof v === 'string' ? (v.trim() || null) : v
    }
    if (Object.keys(patch).length === 0) {
      return res.status(400).json({ error: 'no-patchable-fields' })
    }

    if (patch.is_primary === true) {
      await unsetOtherPrimaries(workspace.id, id)
    }

    const r = await sb(
      `workspace_locations?id=eq.${encodeURIComponent(id)}&workspace_id=eq.${encodeURIComponent(workspace.id)}`,
      {
        method: 'PATCH',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify(patch),
      },
    )
    if (!r.ok) return res.status(500).json({ error: 'db-error' })
    const rows = await r.json().catch(() => null)
    const row = Array.isArray(rows) ? rows[0] : null
    if (!row) return res.status(404).json({ error: 'not-found' })

    // Sync if this row is/became primary, OR if we touched the umbrella fields
    // on whichever row was already primary.
    const touchedUmbrella = ['city', 'region', 'location_keyword', 'location_hashtag'].some(k => k in patch)
    if (row.is_primary || touchedUmbrella) {
      await syncWorkspaceFromPrimary(workspace.id)
    }
    return res.status(200).json(row)
  }

  if (req.method === 'DELETE') {
    const id = req.query?.id
    if (!id) return res.status(400).json({ error: 'missing-id' })

    // Don't allow archiving the primary — admin must promote a different
    // location first. Avoids leaving a workspace with no primary.
    const cur = await sb(
      `workspace_locations?id=eq.${encodeURIComponent(id)}&workspace_id=eq.${encodeURIComponent(workspace.id)}&select=is_primary&limit=1`
    )
    if (!cur.ok) return res.status(500).json({ error: 'db-error' })
    const curRows = await cur.json().catch(() => null)
    const curRow = Array.isArray(curRows) ? curRows[0] : null
    if (!curRow) return res.status(404).json({ error: 'not-found' })
    if (curRow.is_primary) return res.status(409).json({ error: 'cannot-archive-primary' })

    const r = await sb(
      `workspace_locations?id=eq.${encodeURIComponent(id)}&workspace_id=eq.${encodeURIComponent(workspace.id)}`,
      {
        method: 'PATCH',
        body: JSON.stringify({ status: 'archived' }),
      },
    )
    if (!r.ok) return res.status(500).json({ error: 'db-error' })
    return res.status(200).json({ ok: true })
  }

  return res.status(405).json({ error: 'method-not-allowed' })
}

export default withSentry(handler)
