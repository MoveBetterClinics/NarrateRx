// GET  /api/content-plan/atoms?interview_id=X  — list atoms for an interview
// PATCH /api/content-plan/atoms?id=X           — update atom status (skip / reset to pending)
export const config = { runtime: 'nodejs' }

import { workspaceContext } from '../_lib/workspaceContext.js'
import { requireRole } from '../_lib/auth.js'
import { EDITOR_ROLES } from '../_lib/roles.js'
import { enforceLimit } from '../_lib/ratelimit.js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY

function sb(path, init = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey:        SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      Prefer:        'return=representation',
      ...init.headers,
    },
  })
}

const ok  = (res, data, status = 200) => res.status(status).json(data)
const err = (res, msg, status = 400)  => res.status(status).json({ error: msg })

const SELECT = 'id,interview_id,platform,slot,angle,angle_label,angle_description,status,content_piece_id,created_at,updated_at,content_piece:content_items!content_piece_id(status,published_at,scheduled_at)'

export default async function handler(req, res) {
  const { searchParams } = new URL(req.url, 'http://localhost')

  const ws = await workspaceContext(req)
  if (!ws) return err(res, 'Workspace not resolved', 400)
  const wsFilter = `workspace_id=eq.${ws.id}`

  const allowedRoles = req.method === 'GET' ? null : EDITOR_ROLES
  const auth = await requireRole(req, allowedRoles, { orgId: ws.clerk_org_id })
  if (!auth.ok) {
    return res.status(auth.reason === 'forbidden' ? 403 : 401).json({ error: auth.reason })
  }

  if (req.method === 'GET') {
    if (!(await enforceLimit(req, res, 'read'))) return
    const interviewId = searchParams.get('interview_id')
    if (!interviewId) return err(res, 'Missing interview_id')

    const r = await sb(
      `content_plan_atoms?interview_id=eq.${interviewId}&${wsFilter}&select=${SELECT}&order=platform.asc,slot.asc`
    )
    if (!r.ok) return err(res, 'Database error', 500)
    return ok(res, await r.json())
  }

  if (req.method === 'PATCH') {
    if (!(await enforceLimit(req, res, 'write'))) return
    const id = searchParams.get('id')
    if (!id) return err(res, 'Missing id')

    const { status } = req.body || {}
    if (!status) return err(res, 'Missing status')
    if (!['pending', 'skipped'].includes(status)) return err(res, 'Invalid status')

    const r = await sb(`content_plan_atoms?id=eq.${id}&${wsFilter}`, {
      method: 'PATCH',
      body: JSON.stringify({ status, updated_at: new Date().toISOString() }),
    })
    if (!r.ok) return err(res, 'Database error', 500)
    const rows = await r.json()
    return ok(res, rows[0] ?? null)
  }

  return err(res, 'Method not allowed', 405)
}
