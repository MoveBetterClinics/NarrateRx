// POST /api/editorial/render-clip
//
// Phase 2 Day 7 of the 30-day video output build. Takes a photo asset
// (media_assets row) + caption text + a list of channels, renders each
// channel as a branded JPEG, uploads results to Vercel Blob, and returns
// the URLs.
//
// Video rendering is Phase 2 Day 7b — this endpoint handles photos only
// for now (returns 415 if the asset is a video).
//
// Body:
//   {
//     assetId: string,             // media_assets.id
//     captionText?: string,        // overlaid at top/bottom of each channel
//     channels?: string[]          // default: all photo channels
//   }
//
// Auth: Clerk JWT + workspace org-id check + video_pipeline_enabled gate.
//
// Response 200:
//   {
//     assetId, sourceBlobUrl, captionText,
//     renders: [{ channel, blobUrl, width, height, sizeBytes }, ...]
//   }
// Errors: 400 / 401 / 403 / 404 / 415 / 500.

export const config = { runtime: 'nodejs', maxDuration: 300 }

import { put as blobPut } from '@vercel/blob'
import { waitUntil } from '@vercel/functions'
import { requireRole } from '../_lib/auth.js'
import { ALL_KNOWN_ROLES } from '../_lib/roles.js'
import { workspaceContext } from '../_lib/workspaceContext.js'
import { renderPhotoChannel, CHANNEL_SPECS } from '../_lib/brandRender.js'

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

const DEFAULT_PHOTO_CHANNELS = ['linkedin_feed', 'instagram_reel_still', 'blog_hero']

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'method_not_allowed' })
  }

  // --- Workspace + auth ---
  const ws = await workspaceContext(req)
  if (!ws) return res.status(404).json({ error: 'no_workspace' })
  if (!ws.video_pipeline_enabled) {
    return res.status(403).json({ error: 'feature_disabled' })
  }

  const auth = await requireRole(req, ALL_KNOWN_ROLES, { orgId: ws.clerk_org_id })
  if (!auth.ok) {
    return res.status(auth.reason === 'forbidden' ? 403 : 401).json({ error: auth.reason })
  }

  // --- Validate body ---
  const body = req.body || {}
  const assetId = String(body.assetId || '').trim()
  if (!assetId) return res.status(400).json({ error: 'assetId_required' })

  const captionText = String(body.captionText || '').slice(0, 500)

  const channels = Array.isArray(body.channels) && body.channels.length
    ? body.channels.map((c) => String(c))
    : DEFAULT_PHOTO_CHANNELS

  for (const c of channels) {
    if (!CHANNEL_SPECS[c]) {
      return res.status(400).json({ error: 'invalid_channel', channel: c })
    }
  }

  // --- Fetch asset + clinician ---
  const assetRes = await sb(
    `media_assets?id=eq.${assetId}&workspace_id=eq.${ws.id}` +
      `&select=id,kind,blob_url,filename,clinician_id,archived_at`,
  )
  if (!assetRes.ok) return res.status(500).json({ error: 'db_error' })
  const assets = await assetRes.json()
  const asset = assets?.[0]
  if (!asset) return res.status(404).json({ error: 'asset_not_found' })
  if (asset.archived_at) return res.status(404).json({ error: 'asset_archived' })
  if (asset.kind !== 'photo') {
    return res.status(415).json({ error: 'video_rendering_not_yet_supported', kind: asset.kind })
  }
  if (!asset.blob_url) return res.status(500).json({ error: 'asset_missing_blob_url' })

  let clinicianName = ''
  if (asset.clinician_id) {
    const cRes = await sb(`clinicians?id=eq.${asset.clinician_id}&select=name`)
    if (cRes.ok) {
      const cRows = await cRes.json()
      clinicianName = cRows?.[0]?.name || ''
    }
  }

  // --- Render each channel + upload ---
  const renders = []
  const errors = []
  const renderStartedAt = Date.now()

  for (const channel of channels) {
    try {
      const { buffer, width, height } = await renderPhotoChannel({
        photoUrl: asset.blob_url,
        channel,
        captionText,
        workspace: ws,
        clinicianName,
      })

      // Deterministic path per asset+channel so re-renders overwrite cleanly.
      const safeFilename = (asset.filename || 'render').replace(/[^\w.-]/g, '_').replace(/\.\w+$/, '')
      const pathname = `media/renders/${ws.slug}/${asset.id}/${channel}-${safeFilename}.jpg`

      const blob = await blobPut(pathname, buffer, {
        access: 'public',
        contentType: 'image/jpeg',
        addRandomSuffix: false,
        allowOverwrite: true,
      })

      renders.push({
        channel,
        blobUrl: blob.url,
        width,
        height,
        sizeBytes: buffer.length,
      })
    } catch (e) {
      errors.push({ channel, error: e?.message || 'unknown' })
    }
  }

  const elapsedMs = Date.now() - renderStartedAt

  // Best-effort: log render for analytics in a future Phase 2 enhancement.
  waitUntil(Promise.resolve()) // placeholder

  return res.status(renders.length > 0 ? 200 : 500).json({
    assetId,
    sourceBlobUrl: asset.blob_url,
    captionText,
    clinicianName,
    renders,
    errors: errors.length ? errors : undefined,
    elapsedMs,
  })
}
