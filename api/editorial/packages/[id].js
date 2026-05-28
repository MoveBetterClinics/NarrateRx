// PATCH /api/editorial/packages/:id
//
// Update a single story package. Currently supports status transitions
// for the Story Director UI (skip, etc.). Approve → Drafts is handled
// by POST /api/editorial/approve-package (Phase 3 PR 2).
//
// Body (PATCH):
//   { status: 'skipped' | 'complete' }   — currently only skipped is UI-driven
//
// Auth: Clerk JWT + workspace org-id + video_pipeline_enabled.
// Only the owning workspace's packages are accessible.

export const config = { runtime: 'nodejs' }

import { requireRole } from '../../_lib/auth.js'
import { ALL_KNOWN_ROLES } from '../../_lib/roles.js'
import { workspaceContext } from '../../_lib/workspaceContext.js'

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

const ALLOWED_STATUS_TRANSITIONS = new Set(['skipped', 'complete'])

export default async function handler(req, res) {
  if (req.method !== 'PATCH') {
    return res.status(405).json({ error: 'method_not_allowed' })
  }

  const url = new URL(req.url, 'http://localhost')
  const id = url.pathname.split('/').at(-1)
  if (!id || id === 'packages') {
    return res.status(400).json({ error: 'missing_id' })
  }

  const ws = await workspaceContext(req)
  if (!ws) return res.status(404).json({ error: 'no_workspace' })
  if (!ws.video_pipeline_enabled) {
    return res.status(403).json({ error: 'feature_disabled' })
  }

  const auth = await requireRole(req, ALL_KNOWN_ROLES, { orgId: ws.clerk_org_id })
  if (!auth.ok) {
    return res.status(auth.reason === 'forbidden' ? 403 : 401).json({ error: auth.reason })
  }

  const body = req.body || {}
  const { status } = body

  if (!status || !ALLOWED_STATUS_TRANSITIONS.has(status)) {
    return res.status(400).json({
      error: 'invalid_status',
      allowed: [...ALLOWED_STATUS_TRANSITIONS],
    })
  }

  const patchRes = await sb(
    `story_packages?id=eq.${id}&workspace_id=eq.${ws.id}`,
    {
      method: 'PATCH',
      body: JSON.stringify({ status, updated_at: new Date().toISOString() }),
    }
  )

  if (!patchRes.ok) {
    const text = await patchRes.text().catch(() => '')
    console.error('[packages/[id]] patch failed:', patchRes.status, text)
    return res.status(500).json({ error: 'db_error' })
  }

  const updated = await patchRes.json()
  if (!updated?.length) {
    return res.status(404).json({ error: 'package_not_found' })
  }

  return res.status(200).json({ package: updated[0] })
}
