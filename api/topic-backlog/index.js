// GET    /api/topic-backlog              — list backlog for the workspace
// POST   /api/topic-backlog              — add a manual topic (or array of rows)
// PATCH  /api/topic-backlog?id=X         — update status/priority/topic/rationale
// DELETE /api/topic-backlog?id=X         — remove
export const config = { runtime: 'nodejs' }

import { workspaceContext } from '../_lib/workspaceContext.js'
import { requireRole } from '../_lib/auth.js'
import { STAFF_ROLES } from '../_lib/roles.js'
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

const SELECT = 'id,topic,rationale,source,priority,status,interview_id,created_at,updated_at'

const ALLOWED_STATUS = new Set(['pending', 'in_progress', 'completed', 'archived'])

export default async function handler(req, res) {
  const { searchParams } = new URL(req.url, 'http://localhost')
  const ws = await workspaceContext(req)
  if (!ws) return err(res, 'Workspace not resolved', 400)
  const wsFilter = `workspace_id=eq.${ws.id}`

  const allowedRoles = req.method === 'GET' ? null : STAFF_ROLES
  const auth = await requireRole(req, allowedRoles, { orgId: ws.clerk_org_id })
  if (!auth.ok) {
    return res.status(auth.reason === 'forbidden' ? 403 : 401).json({ error: auth.reason })
  }

  if (req.method === 'GET') {
    if (!(await enforceLimit(req, res, 'read'))) return
    const status = searchParams.get('status')
    let qs = `topic_backlog?${wsFilter}&select=${SELECT}&order=priority.desc,created_at.desc`
    if (status) qs += `&status=eq.${status}`
    const r = await sb(qs)
    if (!r.ok) return err(res, 'Database error', 500)
    return ok(res, await r.json())
  }

  if (req.method === 'POST') {
    if (!(await enforceLimit(req, res, 'write'))) return
    const body = req.body
    const rows = Array.isArray(body) ? body : [body]
    const inserts = rows
      .filter((r) => r?.topic?.trim?.())
      .map((r) => ({
        workspace_id: ws.id,
        topic:        r.topic.trim(),
        rationale:    r.rationale ?? null,
        source:       r.source === 'ai_suggested' ? 'ai_suggested' : 'manual',
        priority:     Number.isFinite(r.priority) ? r.priority : 50,
      }))
    if (inserts.length === 0) return err(res, 'No topics to insert')

    const r = await sb('topic_backlog', { method: 'POST', body: JSON.stringify(inserts) })
    if (!r.ok) return err(res, 'Database error', 500)
    return ok(res, await r.json(), 201)
  }

  if (req.method === 'PATCH') {
    if (!(await enforceLimit(req, res, 'write'))) return
    const id = searchParams.get('id')
    if (!id) return err(res, 'Missing id')

    const patch = req.body || {}
    const allowed = {}
    if (patch.status !== undefined) {
      if (!ALLOWED_STATUS.has(patch.status)) return err(res, 'Invalid status')
      allowed.status = patch.status
    }
    if (patch.priority !== undefined) {
      const p = Number(patch.priority)
      if (!Number.isFinite(p)) return err(res, 'Invalid priority')
      allowed.priority = p
    }
    if (patch.topic !== undefined) allowed.topic = String(patch.topic).trim()
    if (patch.rationale !== undefined) allowed.rationale = patch.rationale
    if (patch.interview_id !== undefined) allowed.interview_id = patch.interview_id || null
    if (Object.keys(allowed).length === 0) return err(res, 'No editable fields supplied')

    allowed.updated_at = new Date().toISOString()
    const r = await sb(`topic_backlog?id=eq.${id}&${wsFilter}`, {
      method: 'PATCH',
      body: JSON.stringify(allowed),
    })
    if (!r.ok) return err(res, 'Database error', 500)
    const rows = await r.json()
    return ok(res, rows[0] ?? null)
  }

  if (req.method === 'DELETE') {
    if (!(await enforceLimit(req, res, 'write'))) return
    const id = searchParams.get('id')
    if (!id) return err(res, 'Missing id')
    const r = await sb(`topic_backlog?id=eq.${id}&${wsFilter}`, {
      method: 'DELETE',
      headers: { Prefer: 'return=minimal' },
    })
    if (!r.ok) return err(res, 'Database error', 500)
    return ok(res, { ok: true })
  }

  return err(res, 'Method not allowed', 405)
}
