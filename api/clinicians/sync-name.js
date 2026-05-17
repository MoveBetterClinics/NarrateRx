// POST /api/clinicians/sync-name  { name: string }
//
// Propagates a Clerk display-name change onto the calling user's Self
// clinician row(s) in the current workspace. Scoped by:
//   workspace_id = current workspace (subdomain)
//   user_id     = current Clerk user
//
// Only Self clinicians get touched. Proxy rows (admin recording someone
// else's interview, user_id is null) keep whatever label they were given.
//
// Called by the Account page right after `user.update({ unsafeMetadata })`
// succeeds. Idempotent: re-running with the same name is a no-op.

export const config = { runtime: 'nodejs' }

import { requireRole } from '../_lib/auth.js'
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

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  if (!(await enforceLimit(req, res, 'media'))) return

  const auth = await requireRole(req, null)
  if (!auth.ok) return res.status(auth.reason === 'forbidden' ? 403 : 401).json({ error: auth.reason })

  const ws = await workspaceContext(req)
  if (!ws) return res.status(400).json({ error: 'Workspace not resolved' })

  const { name } = req.body || {}
  if (!name?.trim()) return res.status(400).json({ error: 'Name required' })

  const r = await sb(
    `clinicians?workspace_id=eq.${ws.id}&user_id=eq.${encodeURIComponent(auth.userId)}`,
    {
      method: 'PATCH',
      body: JSON.stringify({ name: name.trim(), updated_at: new Date().toISOString() }),
    }
  )
  if (!r.ok) {
    const body = await r.text().catch(() => '')
    console.error(`[clinicians/sync-name] supabase ${r.status}: ${body.slice(0, 500)}`)
    return res.status(500).json({ error: 'Database error' })
  }
  const updated = await r.json()
  return res.status(200).json({ updated: Array.isArray(updated) ? updated.length : 0 })
}
