// PATCH /api/media/:id/consent
//
// Phase 3 PR 5: per-asset consent management for the Story Director Slate.
//
// Open to all workspace members (clinicians manage consent — they're the ones
// with the patient relationship). Updates four fields atomically:
//   consent_status     — required ('not_required' | 'pending' | 'obtained' | 'revoked')
//   consent_notes      — optional freeform context (max 500 chars)
//   consent_updated_at — set to now()
//   consent_updated_by — set to caller's Clerk user id
//
// Body:
//   { status: string, notes?: string }
//
// Response 200: { asset: { ... consent fields } }

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

const ALLOWED_STATUSES = new Set(['not_required', 'pending', 'obtained', 'revoked'])

export default async function handler(req, res) {
  if (req.method !== 'PATCH') {
    return res.status(405).json({ error: 'method_not_allowed' })
  }

  // Pathname is /api/media/<id>/consent — id is the second-to-last segment.
  const url = new URL(req.url, 'http://localhost')
  const segments = url.pathname.split('/').filter(Boolean)
  const id = segments[segments.length - 2]
  if (!id || id === 'media') {
    return res.status(400).json({ error: 'missing_id' })
  }

  const ws = await workspaceContext(req)
  if (!ws) return res.status(404).json({ error: 'no_workspace' })

  const auth = await requireRole(req, ALL_KNOWN_ROLES, { orgId: ws.clerk_org_id })
  if (!auth.ok) {
    return res.status(auth.reason === 'forbidden' ? 403 : 401).json({ error: auth.reason })
  }

  const { status, notes } = req.body || {}
  if (!status || !ALLOWED_STATUSES.has(status)) {
    return res.status(400).json({ error: 'invalid_status', allowed: [...ALLOWED_STATUSES] })
  }

  const patch = {
    consent_status:     status,
    consent_updated_at: new Date().toISOString(),
    consent_updated_by: auth.userId || null,
  }
  if (notes !== undefined) {
    patch.consent_notes = typeof notes === 'string' ? notes.slice(0, 500) : null
  }

  const patchRes = await sb(
    `media_assets?id=eq.${id}&workspace_id=eq.${ws.id}`,
    {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }
  )
  if (!patchRes.ok) {
    const text = await patchRes.text().catch(() => '')
    console.error('[media/[id]/consent] patch failed:', patchRes.status, text)
    return res.status(500).json({ error: 'db_error' })
  }

  const rows = await patchRes.json()
  if (!rows?.length) return res.status(404).json({ error: 'asset_not_found' })

  return res.status(200).json({ asset: rows[0] })
}
