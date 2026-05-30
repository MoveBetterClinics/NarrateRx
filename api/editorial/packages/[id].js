// PATCH /api/editorial/packages/:id
//
// Update a single story package. Supports:
//   - status transitions (skip / cancel)
//   - caption_text edits (inline edit from Story Slate)
//
// Body (PATCH):
//   { status?: 'skipped' | 'complete' | 'canceled' }
//   { captionText?: string }   — caption edit; marks renders stale
//   Both fields may be present simultaneously.
//
// Cancel ('canceled') is cooperative: it only applies while the package is
// still generating (status in generating/pending/pending_broll). It can't kill
// the in-flight Vercel waitUntil render, but it (a) unblocks the producer
// immediately — the Slate drops canceled cards — and (b) the background render's
// terminal PATCH is guarded (renderPackageChannels.js / syntheticBroll.js) so a
// late finish can't resurrect a canceled card to complete/failed. Canceling a
// package that has already settled returns 409 already_settled.
//
// Auth: Clerk JWT + workspace org-id + video_pipeline_enabled.
// Only the owning workspace's packages are accessible.

export const config = { runtime: 'nodejs' }

import { waitUntil } from '@vercel/functions'
import { requireRole } from '../../_lib/auth.js'
import { ALL_KNOWN_ROLES } from '../../_lib/roles.js'
import { workspaceContext } from '../../_lib/workspaceContext.js'
import { scoreCaptionFidelity } from '../../_lib/captionFidelity.js'

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

const ALLOWED_STATUS_TRANSITIONS = new Set(['skipped', 'complete', 'canceled'])

// A package can only be canceled while it's still generating. PostgREST `in.`
// list — kept in sync with the guard in renderPackageChannels.js / syntheticBroll.js.
const CANCELABLE_STATUSES = 'generating,pending,pending_broll'

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
  const { status, captionText } = body

  if (status !== undefined && !ALLOWED_STATUS_TRANSITIONS.has(status)) {
    return res.status(400).json({
      error: 'invalid_status',
      allowed: [...ALLOWED_STATUS_TRANSITIONS],
    })
  }

  if (captionText !== undefined && (typeof captionText !== 'string' || captionText.trim().length === 0)) {
    return res.status(400).json({ error: 'caption_text_empty' })
  }

  if (status === undefined && captionText === undefined) {
    return res.status(400).json({ error: 'nothing_to_update' })
  }

  const patch = { updated_at: new Date().toISOString() }
  if (status !== undefined) patch.status = status
  if (captionText !== undefined) {
    patch.caption_text = captionText.trim().slice(0, 1000)
  }

  // Cancel is guarded: only flips a still-generating row. The extra status
  // filter means a row that already settled (complete/failed/approved) matches
  // zero rows → 409 already_settled, so we never "uncomplete" a finished package.
  const isCancel = status === 'canceled'
  const filter = isCancel
    ? `story_packages?id=eq.${id}&workspace_id=eq.${ws.id}&status=in.(${CANCELABLE_STATUSES})`
    : `story_packages?id=eq.${id}&workspace_id=eq.${ws.id}`

  const patchRes = await sb(filter, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  })

  if (!patchRes.ok) {
    const text = await patchRes.text().catch(() => '')
    console.error('[packages/[id]] patch failed:', patchRes.status, text)
    return res.status(500).json({ error: 'db_error' })
  }

  const updated = await patchRes.json()
  if (!updated?.length) {
    // For a cancel, zero rows almost always means the render already finished
    // between the producer clicking Stop and this request landing.
    if (isCancel) {
      return res.status(409).json({ error: 'already_settled' })
    }
    return res.status(404).json({ error: 'package_not_found' })
  }

  // If the caption changed, re-score in the background. The renders are
  // now stale visually, but the score reflects topic+caption text which
  // is what matters for the gate / badge.
  if (captionText !== undefined) {
    const row = updated[0]
    waitUntil(
      scoreCaptionFidelity({
        packageId:     row.id,
        workspaceId:   ws.id,
        workspaceName: ws.display_name,
        staffId:   row.staff_id || null,
        topic:         row.topic,
        captionText:   row.caption_text,
      }).catch((e) => {
        console.error('[packages/[id]] caption fidelity scoring failed:', e?.message || e)
      })
    )
  }

  return res.status(200).json({ package: updated[0] })
}
