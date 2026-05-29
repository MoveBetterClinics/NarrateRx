// PATCH /api/editorial/segments/:id
//
// Multi-clip video v1 (Phase 2). Updates the review status of one proposed
// segment — keep or discard — from the Slate segment picker. Rendering a kept
// segment is a separate step (POST /api/editorial/render-segments), so this
// endpoint only moves review state.
//
// Body:
//   { status: 'kept' | 'discarded' | 'proposed' }
//
// Auth: Clerk JWT + workspace org-id + video_pipeline_enabled.
// Only the owning workspace's segments are accessible.
//
// Responses: 200 { segment } / 400 / 401 / 403 / 404 / 409 / 500

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

// Review-state transitions a clinician may make from the picker. 'rendered' is
// terminal and only set by the render path, so it isn't allowed here.
const ALLOWED_STATUS = new Set(['kept', 'discarded', 'proposed'])

export default async function handler(req, res) {
  if (req.method !== 'PATCH') {
    return res.status(405).json({ error: 'method_not_allowed' })
  }

  const url = new URL(req.url, 'http://localhost')
  const id = url.pathname.split('/').at(-1)
  if (!id || id === 'segments') {
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

  const status = String((req.body || {}).status || '')
  if (!ALLOWED_STATUS.has(status)) {
    return res.status(400).json({ error: 'invalid_status', allowed: [...ALLOWED_STATUS] })
  }

  // Don't let a review toggle stomp a segment that's already been rendered into
  // a package — that's terminal.
  const cur = await sb(
    `video_segments?id=eq.${id}&workspace_id=eq.${ws.id}&select=id,status,story_package_id`,
  )
  if (!cur.ok) return res.status(500).json({ error: 'db_error' })
  const existing = (await cur.json())?.[0]
  if (!existing) return res.status(404).json({ error: 'segment_not_found' })
  if (existing.status === 'rendered' || existing.story_package_id) {
    return res.status(409).json({ error: 'already_rendered' })
  }

  const patchRes = await sb(`video_segments?id=eq.${id}&workspace_id=eq.${ws.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ status }),
  })
  if (!patchRes.ok) return res.status(500).json({ error: 'db_error' })
  const updated = (await patchRes.json())?.[0]

  return res.status(200).json({ segment: updated })
}
