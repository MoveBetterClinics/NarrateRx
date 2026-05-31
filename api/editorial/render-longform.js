// POST /api/editorial/render-longform
//
// Keep-whole long-form video lane (increment ②). The OTHER explicit choice
// next to "Find clips": instead of segmenting a source into many short clips,
// render the WHOLE source as a single landscape, keep-whole (letterboxed,
// no speaker-cropping) story package.
//
// "Keep-whole" is derived, not stored: the package's channels are the long-form
// landscape specs (youtube / linkedin_native / website_embed) added in PR #999.
// Those specs carry fit:'contain' + longform:true, so brandRenderVideo.js
// automatically letterboxes to 16:9 and uses the 120s long-form duration budget
// (LONGFORM_MAX_SECONDS) instead of the 60s clip cap. No format column, no
// migration — the render keys off the channel spec.
//
// Body:
//   { assetId: string }   // a non-archived source video with a blob_url
//
// Auth: Clerk JWT + workspace org-id + video_pipeline_enabled (mirrors
// render-segments.js exactly).
//
// Responses:
//   202 { packageId, status: 'generating', channels }
//   400 / 401 / 403 / 404 / 500
//
// Note: all package-create + caption + chunk logic lives in kickLongformRender.js.
// This handler validates the request and delegates; see that file for the render
// implementation. campaignId is null here (direct "Full video" action, no campaign).

export const config = { runtime: 'nodejs', maxDuration: 300 }

import { requireRole } from '../_lib/auth.js'
import { ALL_KNOWN_ROLES } from '../_lib/roles.js'
import { workspaceContext } from '../_lib/workspaceContext.js'
import { kickLongformRender } from '../_lib/kickLongformRender.js'

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
  const assetId = body.assetId ? String(body.assetId) : ''
  if (!assetId) return res.status(400).json({ error: 'assetId_required' })

  // Fetch the source asset (workspace-scoped).
  const aRes = await sb(
    `media_assets?id=eq.${assetId}&workspace_id=eq.${ws.id}` +
      `&select=id,kind,blob_url,filename,staff_id,visual_narrative,transcription,archived_at&limit=1`,
  )
  if (!aRes.ok) return res.status(500).json({ error: 'db_error' })
  const asset = (await aRes.json())?.[0]

  if (!asset) return res.status(404).json({ error: 'asset_not_found' })
  if (asset.kind !== 'video' || !asset.blob_url || asset.archived_at) {
    return res.status(400).json({ error: 'invalid_source' })
  }

  // Origin for the chunk engine's self-continuation POSTs (Node runtime headers).
  const proto = req.headers['x-forwarded-proto'] || 'https'
  const baseUrl = req.headers.host ? `${proto}://${req.headers.host}` : null

  try {
    const result = await kickLongformRender({ ws, asset, baseUrl, campaignId: null })
    return res.status(202).json({
      packageId: result.packageId,
      status: 'generating',
      channels: result.channels,
      mode: result.mode,
      durationSec: result.durationSec,
      ...(result.mode === 'chunked' ? { chunks: result.chunks } : {}),
    })
  } catch (e) {
    console.error('[render-longform] kickLongformRender failed:', e?.message || e)
    return res.status(500).json({ error: e?.message || 'render_failed' })
  }
}
