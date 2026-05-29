// GET /api/editorial/segments?assetId=<id>
//
// Multi-clip video v1 (Phase 1). Returns the detection lifecycle status for a
// source asset plus its proposed/kept/rendered video_segments, for the Slate
// segment picker to poll while find-clips runs and to render the review list.
//
// Query params:
//   assetId: string (required)
//
// Auth: Clerk JWT + workspace org-id + video_pipeline_enabled.
//
// Response 200:
//   {
//     assetId,
//     status: null | 'detecting' | 'ready' | 'failed',   // from media_assets.segment_status
//     error: string|null,                                 // note on ready, error on failed
//     detectedAt: string|null,
//     segments: [{ id, start_sec, end_sec, hook, why_it_stands_alone,
//                  transcript_excerpt, order_index, status, story_package_id }]
//   }
//   400 / 401 / 403 / 404 / 500

export const config = { runtime: 'nodejs' }

import { requireRole } from '../_lib/auth.js'
import { ALL_KNOWN_ROLES } from '../_lib/roles.js'
import { workspaceContext } from '../_lib/workspaceContext.js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY

async function sb(path, init = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      ...init.headers,
    },
  })
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
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

  const url = new URL(req.url, 'http://localhost')
  const assetId = String(url.searchParams.get('assetId') || '').trim()
  if (!assetId) return res.status(400).json({ error: 'assetId_required' })

  // Asset lifecycle status (workspace-scoped).
  const assetRes = await sb(
    `media_assets?id=eq.${assetId}&workspace_id=eq.${ws.id}` +
      `&select=id,segment_status,segment_error,segments_detected_at`,
  )
  if (!assetRes.ok) return res.status(500).json({ error: 'db_error' })
  const asset = (await assetRes.json())?.[0]
  if (!asset) return res.status(404).json({ error: 'asset_not_found' })

  // Proposed/kept/rendered segments for this source (workspace-scoped).
  const segRes = await sb(
    `video_segments?source_asset_id=eq.${assetId}&workspace_id=eq.${ws.id}` +
      `&order=order_index.asc` +
      `&select=id,start_sec,end_sec,hook,why_it_stands_alone,transcript_excerpt,order_index,status,story_package_id`,
  )
  if (!segRes.ok) return res.status(500).json({ error: 'db_error' })
  const segments = await segRes.json()

  return res.status(200).json({
    assetId,
    status: asset.segment_status || null,
    error: asset.segment_error || null,
    detectedAt: asset.segments_detected_at || null,
    segments,
  })
}
