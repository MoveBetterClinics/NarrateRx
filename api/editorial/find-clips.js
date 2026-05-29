// POST /api/editorial/find-clips
//
// Multi-clip video v1 (Phase 1). Kicks off transcript-based segment detection
// for one long source video: transcribe (Whisper, timestamped) → one LLM pass
// proposing standalone ≤60s moments → persist as video_segments rows. The
// clinician reviews + keeps/discards on the Slate; each kept segment renders
// into its own story_package (Phase 2).
//
// Body:
//   { assetId: string, maxSegments?: number }   // maxSegments default 8, max 12
//
// Detection runs OFF the request path (waitUntil + 202): transcribing a long
// seminar takes minutes, which would race the 300s function ceiling and the
// caller's short-lived Clerk token. The source asset's segment_status flips
// 'detecting' → 'ready' | 'failed'; poll GET /api/editorial/segments?assetId=…
//
// Auth: Clerk JWT + workspace org-id + video_pipeline_enabled.
//
// Responses:
//   202 { assetId, status: 'detecting' }
//   400 / 401 / 403 / 404 / 409 (already_detecting) / 415 (not a video) / 500

export const config = { runtime: 'nodejs', maxDuration: 300 }

import { waitUntil } from '@vercel/functions'
import { requireRole } from '../_lib/auth.js'
import { ALL_KNOWN_ROLES } from '../_lib/roles.js'
import { workspaceContext } from '../_lib/workspaceContext.js'
import { detectSegmentsForAsset } from '../_lib/segmentDetect.js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY

async function sb(path, init = {}) {
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
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'method_not_allowed' })
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
  const assetId = String(body.assetId || '').trim()
  if (!assetId) return res.status(400).json({ error: 'assetId_required' })
  const maxSegments = Math.min(Math.max(parseInt(body.maxSegments || '8', 10) || 8, 1), 12)

  // Fetch + workspace-scope the asset.
  const assetRes = await sb(
    `media_assets?id=eq.${assetId}&workspace_id=eq.${ws.id}` +
      `&select=id,kind,blob_url,filename,staff_id,duration_s,archived_at,segment_status`,
  )
  if (!assetRes.ok) return res.status(500).json({ error: 'db_error' })
  const asset = (await assetRes.json())?.[0]
  if (!asset) return res.status(404).json({ error: 'asset_not_found' })
  if (asset.archived_at) return res.status(404).json({ error: 'asset_archived' })
  if (asset.kind !== 'video') {
    return res.status(415).json({ error: 'unsupported_asset_kind', kind: asset.kind })
  }
  if (!asset.blob_url) return res.status(500).json({ error: 'asset_missing_blob_url' })
  if (asset.segment_status === 'detecting') {
    return res.status(409).json({ error: 'already_detecting' })
  }

  // Mark detecting up-front so the UI shows a spinner and a concurrent call
  // 409s. Patch is workspace-scoped.
  const patchRes = await sb(`media_assets?id=eq.${assetId}&workspace_id=eq.${ws.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ segment_status: 'detecting', segment_error: null }),
  })
  if (!patchRes.ok) return res.status(500).json({ error: 'db_error' })

  // Detect off the request path; the Slate polls segment_status.
  waitUntil(
    detectSegmentsForAsset({ workspace: ws, asset, maxSegments }),
  )

  return res.status(202).json({ assetId, status: 'detecting' })
}
