// Pinned to Node runtime so the Edge whole-graph bundler doesn't follow
// the ratelimit.js → @clerk/backend → node:crypto chain into middleware.
// Uses Express-style (req, res) handler — the Web-style (req) → Response
// pattern silently hangs on Vercel's Node runtime (response never sent;
// function times out at 300s). Match the convention used by /api/content-pieces/*.
export const config = { runtime: 'nodejs' }

import { workspaceContext } from '../_lib/workspaceContext.js'
import { enforceLimit } from '../_lib/ratelimit.js'
import { requireRole } from '../_lib/auth.js'
import { ROLE_ADMIN } from '../_lib/roles.js'

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

// Log a Supabase non-ok response body to function logs and return a generic
// 500 to the client. Public response stays opaque (no schema leak); details
// land in Vercel logs so the next "Database error" report is one log fetch
// away from a root cause.
async function dbErr(res, r, msg = 'Database error', status = 500) {
  const body = await r.text().catch(() => '')
  console.error(`[db/settings] ${msg} — supabase ${r.status}: ${body.slice(0, 500)}`)
  return res.status(status).json({ error: msg })
}

const DEFAULT = { mode: 'bookings', notes: '', cta_url: '', cta_label: '', cta_pitch: '', event_at: null }

export default async function handler(req, res) {
  const ws = await workspaceContext(req)
  if (!ws) return err(res, 'Workspace not resolved', 400)
  const wsFilter = `workspace_id=eq.${ws.id}`

  if (req.method === 'GET') {
    const r = await sb(`clinic_settings?${wsFilter}&select=campaign_mode,campaign_notes,campaign_cta_url,campaign_cta_label,campaign_cta_pitch,campaign_event_at`)
    if (!r.ok) {
      console.error(`[db/settings] select failed — supabase ${r.status}: ${(await r.text().catch(() => '')).slice(0, 500)}`)
      return ok(res, DEFAULT)
    }
    const data = await r.json()
    if (!data.length) return ok(res, DEFAULT)
    return ok(res, {
      mode:      data[0].campaign_mode      || 'bookings',
      notes:     data[0].campaign_notes     || '',
      cta_url:   data[0].campaign_cta_url   || '',
      cta_label: data[0].campaign_cta_label || '',
      cta_pitch: data[0].campaign_cta_pitch || '',
      event_at:  data[0].campaign_event_at  || null,
    })
  }

  if (req.method === 'PATCH') {
    // Workspace-wide campaign default is a marketing operating decision —
    // admins only. Per-clinician override lives on a separate handler
    // (api/clinicians/campaign-settings.js) and is editable by the
    // clinician themselves or any admin.
    const auth = await requireRole(req, [ROLE_ADMIN], { orgId: ws.clerk_org_id })
    if (!auth.ok) {
      return res.status(auth.reason === 'forbidden' ? 403 : 401).json({ error: auth.reason })
    }
    if (!(await enforceLimit(req, res, 'media'))) return

    const body = req.body || {}
    const update = { updated_at: new Date().toISOString() }
    if (body.mode)                update.campaign_mode      = body.mode
    if (body.notes     !== undefined) update.campaign_notes     = body.notes
    if (body.cta_url   !== undefined) update.campaign_cta_url   = body.cta_url || null
    if (body.cta_label !== undefined) update.campaign_cta_label = body.cta_label || null
    if (body.cta_pitch !== undefined) update.campaign_cta_pitch = body.cta_pitch || null
    if (body.event_at  !== undefined) update.campaign_event_at  = body.event_at || null
    const userId = req.headers['x-user-id'] ?? null
    if (userId) update.updated_by = userId

    const r = await sb(`clinic_settings`, {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
      body: JSON.stringify({ workspace_id: ws.id, ...update }),
    })
    if (!r.ok) return dbErr(res, r, 'Failed to save settings')
    return ok(res, { success: true })
  }

  return res.status(405).send('Method not allowed')
}
