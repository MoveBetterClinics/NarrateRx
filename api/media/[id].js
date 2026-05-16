import { withSentry } from '../_lib/sentry.js'
import { recordAudit, snapshot } from '../_lib/audit.js'
import { requireRole } from '../_lib/auth.js'
import { STAFF_ROLES } from '../_lib/roles.js'
import { workspaceScope } from '../_lib/workspaceScope.js'

// Per-method role requirements (HANDOFF.md → Locked decisions):
//   GET    → any authenticated user
//   PATCH  → admin or publisher (metadata edits + restore)
//   DELETE → admin or publisher (soft-archive)
//   purge  → admin only (lives in api/media/[id]/purge.js)
const ROLE_REQUIREMENTS = {
  GET:    null,
  PATCH:  STAFF_ROLES,
  DELETE: STAFF_ROLES,
}

// Runs on Node (Fluid Compute) — @vercel/blob's server bits aren't edge-safe.
// Uses the (req, res) handler shape; req is IncomingMessage with auto-parsed
// req.body for JSON requests.
//
// DELETE here is a SOFT delete (Layer 1 of the safety hardening): it stamps
// status='archived' + archived_at=now() and leaves Vercel Blob alone. Hard
// purge lives at api/media/[id]/purge.js — admin-only, ≥30 day cooldown.

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

const SELECT_COMMON = 'id,kind,status,source,blob_url,blob_pathname,rendered_url,drive_id,filename,mime_type,size_bytes,duration_s,aspect_ratio,width,height,thumbnail_url,patient_pseudonym,condition,captured_at,tags,ai_tags,transcription,visual_narrative,asset_purpose,speaker_role,parent_id,notes,alt_text,content_item_ids,archived_at,created_at,updated_at,created_by'

async function fetchRow(where, select) {
  const r = await sb(`media_assets?${where}&select=${select}`)
  if (!r.ok) return null
  const rows = await r.json()
  return rows[0] || null
}

async function handler(req, res) {
  if (!(req.method in ROLE_REQUIREMENTS)) {
    return res.status(405).json({ error: 'Method not allowed' })
  }
  // req.url is a relative path on Node runtime; the base lets URL parse it.
  const url = new URL(req.url, 'http://localhost')
  const id  = url.pathname.split('/').pop()
  if (!id) return res.status(400).json({ error: 'Missing id' })

  const scope = await workspaceScope(req)

  const auth = await requireRole(req, ROLE_REQUIREMENTS[req.method], { orgId: scope.workspace.clerk_org_id })
  if (!auth.ok) {
    return res.status(auth.reason === 'forbidden' ? 403 : 401).json({ error: auth.reason })
  }
  const SELECT = `${scope.column},${SELECT_COMMON}`
  const where  = `id=eq.${id}&${scope.column}=eq.${scope.id}`

  if (req.method === 'GET') {
    const r = await sb(`media_assets?${where}&select=${SELECT}`)
    if (!r.ok) return res.status(500).json({ error: 'Database error' })
    const data = await r.json()
    return res.status(200).json(data[0] ?? null)
  }

  if (req.method === 'PATCH') {
    const patch = req.body || {}
    const allowed = {
      status:            patch.status,
      tags:              patch.tags,
      ai_tags:           patch.aiTags,
      notes:             patch.notes,
      alt_text:          patch.altText,
      patient_pseudonym: patch.patientPseudonym,
      condition:         patch.condition,
      captured_at:       patch.capturedAt,
      transcription:     patch.transcription,
      visual_narrative:  patch.visualNarrative,
      asset_purpose:     patch.assetPurpose,
      speaker_role:      patch.speakerRole,
      duration_s:        patch.durationS,
      aspect_ratio:      patch.aspectRatio,
      width:             patch.width,
      height:            patch.height,
      thumbnail_url:     patch.thumbnailUrl,
      rendered_url:      patch.renderedUrl,
      content_item_ids:  patch.contentItemIds,
    }
    const body = Object.fromEntries(Object.entries(allowed).filter(([, v]) => v !== undefined))

    // Validate asset_purpose if the caller is changing it, and enforce the
    // invariant that speaker_role is only set for interview-purpose rows.
    // Without this guard a flip from interview → photo via the detail drawer
    // would leave a dangling 'clinician' on a row that no longer represents
    // an interview, re-polluting the segmenter eligibility check.
    const ALLOWED_PURPOSES = new Set(['interview', 'broll', 'photo', 'brand'])
    if (body.asset_purpose !== undefined) {
      if (!ALLOWED_PURPOSES.has(body.asset_purpose)) {
        return res.status(400).json({ error: 'Invalid asset_purpose' })
      }
      if (body.asset_purpose !== 'interview') {
        body.speaker_role = null
      }
    }

    // Snapshot before so the audit trail captures what changed.
    const before = await fetchRow(where, SELECT)
    if (!before) return res.status(404).json({ error: 'Not found' })

    // Detect restore: archived row whose status is being moved out of 'archived'.
    // Also clear archived_at so re-archive timestamps a fresh cooldown window.
    const isRestore =
      before.status === 'archived' &&
      typeof body.status === 'string' &&
      body.status !== 'archived'
    if (isRestore) body.archived_at = null

    const r = await sb(`media_assets?${where}`, { method: 'PATCH', body: JSON.stringify(body) })
    if (!r.ok) return res.status(500).json({ error: 'Update failed' })
    const data = await r.json()
    const after = data[0] ?? null

    await recordAudit({
      assetId: id,
      action:  isRestore ? 'restore' : 'edit',
      before:  snapshot(before),
      after:   snapshot(after),
      req,
      scope,
    })

    return res.status(200).json(after)
  }

  if (req.method === 'DELETE') {
    // Soft-delete: status='archived' + archived_at=now(). Leaves Blob alone so
    // the asset is restorable forever via PATCH { status: 'raw'|'tagged' }.
    // Hard purge is gated behind /api/media/[id]/purge — admin-only, ≥30 days
    // after archived_at.
    const before = await fetchRow(where, SELECT)
    if (!before) return res.status(404).json({ error: 'Not found' })

    if (before.status === 'archived') {
      return res.status(200).json({ archived: true, alreadyArchived: true, asset: before })
    }

    const r = await sb(`media_assets?${where}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'archived', archived_at: new Date().toISOString() }),
    })
    if (!r.ok) return res.status(500).json({ error: 'Archive failed' })
    const data = await r.json()
    const after = data[0] ?? null

    await recordAudit({
      assetId: id,
      action:  'archive',
      before:  snapshot(before),
      after:   snapshot(after),
      req,
      scope,
    })

    return res.status(200).json({ archived: true, asset: after })
  }

  return res.status(405).json({ error: 'Method not allowed' })
}

export default withSentry(handler)
