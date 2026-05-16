// Create or update a campaign. Admin-only.
//
// POST body: { id?, name, description?, status?, target_clinician_ids }
//   - If id is present → UPDATE (workspace-scoped).
//   - Else → INSERT (workspace_id from request context, created_by from auth).
//
// Node runtime + (req, res) shape.

export const config = { runtime: 'nodejs' }

import { requireRole } from '../_lib/auth.js'
import { ROLE_ADMIN } from '../_lib/roles.js'
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

async function dbErr(res, r, msg = 'Database error', status = 500) {
  const body = await r.text().catch(() => '')
  console.error(`[campaigns/upsert] ${msg} — supabase ${r.status}: ${body.slice(0, 500)}`)
  return res.status(status).json({ error: msg })
}

const ALLOWED_STATUS = new Set(['active', 'complete', 'archived'])

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }
  if (!(await enforceLimit(req, res, 'default'))) return

  const ws = await workspaceContext(req)
  if (!ws) return res.status(400).json({ error: 'Workspace not resolved' })

  const auth = await requireRole(req, [ROLE_ADMIN], { orgId: ws.clerk_org_id })
  if (!auth.ok) {
    return res.status(auth.reason === 'forbidden' ? 403 : 401).json({ error: auth.reason })
  }

  const body = req.body || {}
  const id = body.id ? String(body.id) : null
  const name = String(body.name || '').trim()
  if (!name) return res.status(400).json({ error: 'name required' })

  const description = body.description ? String(body.description) : null
  const status = ALLOWED_STATUS.has(body.status) ? body.status : 'active'

  const rawTargets = Array.isArray(body.target_clinician_ids) ? body.target_clinician_ids : []
  // Force every element to a string; reject anything obviously non-uuidish so the
  // PostgREST insert doesn't fail with a cryptic 22P02. Keeps the public error
  // response tidy ("invalid clinician id") instead of "Database error".
  const target_clinician_ids = rawTargets
    .map((v) => (v == null ? '' : String(v)))
    .filter((v) => /^[0-9a-f-]{8,}$/i.test(v))

  if (id) {
    // UPDATE — scoped to this workspace so a stale id can't cross-tenant write.
    const patch = { name, description, status, target_clinician_ids }
    const r = await sb(
      `campaigns?id=eq.${encodeURIComponent(id)}&workspace_id=eq.${ws.id}`,
      { method: 'PATCH', body: JSON.stringify(patch) },
    )
    if (!r.ok) return dbErr(res, r, 'Update failed')
    const data = await r.json()
    if (!Array.isArray(data) || data.length === 0) {
      return res.status(404).json({ error: 'Campaign not found' })
    }
    return res.status(200).json(data[0])
  }

  // INSERT
  const row = {
    workspace_id: ws.id,
    name,
    description,
    status,
    target_clinician_ids,
    created_by: auth.userId || null,
  }
  const r = await sb('campaigns', { method: 'POST', body: JSON.stringify(row) })
  if (!r.ok) return dbErr(res, r, 'Insert failed')
  const data = await r.json()
  return res.status(201).json(data[0] ?? null)
}
