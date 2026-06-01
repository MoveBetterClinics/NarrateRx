// GET /api/editorial/clip-counts
//
// Returns a map of { [parentAssetId]: count } for media_assets rows where
// parent_asset_id is set (i.e. clips cut from a source video via Slate).
// Used by the Slate workshop to show "X clips cut" badges on source video cards.
//
// Auth: any workspace role.

export const config = { runtime: 'nodejs' }

import { requireRole } from '../_lib/auth.js'
import { ALL_KNOWN_ROLES } from '../_lib/roles.js'
import { workspaceContext } from '../_lib/workspaceContext.js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY

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

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'method_not_allowed' })
  }

  const ws = await workspaceContext(req)
  if (!ws) return res.status(404).json({ error: 'no_workspace' })

  const auth = await requireRole(req, ALL_KNOWN_ROLES, { orgId: ws.clerk_org_id })
  if (!auth.ok) {
    return res.status(auth.reason === 'forbidden' ? 403 : 401).json({ error: auth.reason })
  }

  // Fetch all rows with a parent_asset_id for this workspace, then count in JS.
  const r = await sb(
    `media_assets?workspace_id=eq.${ws.id}&parent_asset_id=not.is.null&select=parent_asset_id&archived_at=is.null`
  )
  if (!r.ok) return res.status(500).json({ error: 'db_error' })
  const rows = await r.json()

  const counts = {}
  for (const row of rows) {
    const pid = row.parent_asset_id
    counts[pid] = (counts[pid] || 0) + 1
  }

  return res.status(200).json({ counts })
}
