// GET /api/db/locations — list active workspace locations (any signed-in member).
//
// Returns all workspace_locations rows with status='active' for the workspace,
// ordered by position. Used by the location filter chip on the Dashboard and
// the Locations overview section in the right rail.
//
// Write operations (POST/PATCH/DELETE) live in api/workspace/locations.js
// (admin-only) — this endpoint is read-only so any workspace member can
// fetch the location list for filtering purposes.
export const config = { runtime: 'nodejs' }

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

async function dbErr(res, r, msg = 'Database error', status = 500) {
  const body = await r.text().catch(() => '')
  console.error(`[db/locations] ${msg} — supabase ${r.status}: ${body.slice(0, 500)}`)
  return res.status(status).json({ error: msg })
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'method-not-allowed' })
  }

  const ws = await workspaceContext(req)
  if (!ws) return res.status(400).json({ error: 'Workspace not resolved' })

  const r = await sb(
    `workspace_locations?workspace_id=eq.${encodeURIComponent(ws.id)}&status=eq.active` +
    `&select=id,label,city,region,location_keyword,location_hashtag,visit_url,is_primary,position` +
    `&order=position.asc`
  )
  if (!r.ok) return dbErr(res, r)

  const rows = await r.json().catch(() => [])
  res.setHeader('Cache-Control', 'private, max-age=300')
  return res.status(200).json(Array.isArray(rows) ? rows : [])
}
