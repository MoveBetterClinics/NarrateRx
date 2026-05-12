// Pinned to Node runtime so the Edge whole-graph bundler doesn't follow
// the ratelimit.js → @clerk/backend → node:crypto chain into middleware.
// Uses Express-style (req, res) handler — the Web-style (req) → Response
// pattern silently hangs on Vercel's Node runtime (response never sent;
// function times out at 300s). Match the convention used by /api/content-pieces/*.
export const config = { runtime: 'nodejs' }

import { workspaceContext } from '../_lib/workspaceContext.js'
import { enforceLimit } from '../_lib/ratelimit.js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY

function sb(path, init = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
      ...init.headers,
    },
  })
}

const ok  = (res, data, status = 200) => res.status(status).json(data)
const err = (res, msg, status = 400)  => res.status(status).json({ error: msg })

const DEFAULT = { mode: 'bookings', notes: '' }

export default async function handler(req, res) {
  const ws = await workspaceContext(req)
  if (!ws) return err(res, 'Workspace not resolved', 400)
  const wsFilter = `workspace_id=eq.${ws.id}`

  if (req.method === 'GET') {
    const r = await sb(`clinic_settings?${wsFilter}&select=campaign_mode,campaign_notes`)
    if (!r.ok) return ok(res, DEFAULT)
    const data = await r.json()
    if (!data.length) return ok(res, DEFAULT)
    return ok(res, { mode: data[0].campaign_mode || 'bookings', notes: data[0].campaign_notes || '' })
  }

  if (req.method === 'PATCH') {
    if (!(await enforceLimit(req, res, 'media'))) return

    const body = req.body || {}
    const update = { updated_at: new Date().toISOString() }
    if (body.mode) update.campaign_mode = body.mode
    if (body.notes !== undefined) update.campaign_notes = body.notes
    const userId = req.headers['x-user-id'] ?? req.headers.get?.('x-user-id') ?? null
    if (userId) update.updated_by = userId

    const r = await sb(`clinic_settings`, {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
      body: JSON.stringify({ workspace_id: ws.id, ...update }),
    })
    if (!r.ok) return err(res, 'Failed to save settings', 500)
    return ok(res, { success: true })
  }

  return res.status(405).send('Method not allowed')
}
