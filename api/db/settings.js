export const config = { runtime: 'edge' }

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
      Prefer: 'return=representation',
      ...init.headers,
    },
  })
}

const ok = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })
const err = (msg, status = 400) =>
  new Response(JSON.stringify({ error: msg }), { status, headers: { 'Content-Type': 'application/json' } })

const DEFAULT = { mode: 'bookings', notes: '' }

export default async function handler(req) {
  const ws = await workspaceContext(req)
  if (!ws) return err('Workspace not resolved', 400)
  const wsFilter = `workspace_id=eq.${ws.id}`

  if (req.method === 'GET') {
    const res = await sb(`clinic_settings?${wsFilter}&select=campaign_mode,campaign_notes`)
    if (!res.ok) return ok(DEFAULT)
    const data = await res.json()
    if (!data.length) return ok(DEFAULT)
    return ok({ mode: data[0].campaign_mode || 'bookings', notes: data[0].campaign_notes || '' })
  }

  if (req.method === 'PATCH') {
    const body = await req.json().catch(() => ({}))
    const update = { updated_at: new Date().toISOString() }
    if (body.mode) update.campaign_mode = body.mode
    if (body.notes !== undefined) update.campaign_notes = body.notes
    const userId = req.headers.get('x-user-id')
    if (userId) update.updated_by = userId

    const res = await sb(`clinic_settings?${wsFilter}`, {
      method: 'PATCH',
      body: JSON.stringify(update),
    })
    if (!res.ok) return err('Failed to save settings', 500)
    return ok({ success: true })
  }

  return new Response('Method not allowed', { status: 405 })
}
