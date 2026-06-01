// POST /api/editorial/render-clip
//
// Phase 2 Day 7/7b of the 30-day video output build.
// Renders a media asset (photo or video) into per-channel branded outputs.
//
// Photos  → JPEG per channel   (Sharp + SVG overlay)
// Videos  → MP4  per channel   (ffmpeg + Whisper subs + Sharp SVG overlay PNG)
//
// Body:
//   {
//     assetId: string,             // media_assets.id
//     captionText?: string,        // overlaid in caption band (photos + videos)
//     channels?: string[]          // default: 3 most-used channels for the asset kind
//   }
//
// Auth: Clerk JWT + workspace org-id check + video_pipeline_enabled gate.
//
// Response 200:
//   {
//     assetId, kind, sourceBlobUrl, captionText, staffName,
//     renders: [{ channel, blobUrl, width, height, sizeBytes, hadSubtitles? }, ...],
//     errors?: [{ channel, error }],
//     elapsedMs
//   }
// Errors: 400 / 401 / 403 / 404 / 500.

export const config = { runtime: 'nodejs', maxDuration: 300 }

import { put as blobPut } from '@vercel/blob'
import { waitUntil } from '@vercel/functions'
import { requireRole } from '../_lib/auth.js'
import { ALL_KNOWN_ROLES } from '../_lib/roles.js'
import { workspaceContext } from '../_lib/workspaceContext.js'
import { renderPhotoChannel, CHANNEL_SPECS } from '../_lib/brandRender.js'
import { renderVideoChannel, VIDEO_CHANNEL_SPECS } from '../_lib/brandRenderVideo.js'

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
const DEFAULT_VIDEO_CHANNELS = ['linkedin_video', 'instagram_reel', 'blog_hero_video']

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
  const startSec = body.startSec != null ? Number(body.startSec) : undefined
  const durationSec = body.durationSec != null ? Number(body.durationSec) : undefined
  const subtitles = body.subtitles !== undefined ? Boolean(body.subtitles) : undefined
  const requestedChannels = Array.isArray(body.channels) && body.channels.length
    ? body.channels.map((c) => String(c))
    : null  // resolved after we know asset kind

  // --- Fetch asset + clinician ---
  const assetRes = await sb(
    `media_assets?id=eq.${assetId}&workspace_id=eq.${ws.id}` +
      `&select=id,kind,blob_url,filename,staff_id,archived_at`,
  )
  if (!assetRes.ok) return res.status(500).json({ error: 'db_error' })
  const assets = await assetRes.json()
  const asset = assets?.[0]
  if (!asset) return res.status(404).json({ error: 'asset_not_found' })
  if (asset.archived_at) return res.status(404).json({ error: 'asset_archived' })
  if (!asset.blob_url) return res.status(500).json({ error: 'asset_missing_blob_url' })

  const isVideo = asset.kind === 'video'
  const isPhoto = asset.kind === 'photo'
  if (!isVideo && !isPhoto) {
    return res.status(415).json({ error: 'unsupported_asset_kind', kind: asset.kind })
  }

  // Resolve channels + validate against the appropriate spec map for this kind.
  const specMap = isVideo ? VIDEO_CHANNEL_SPECS : CHANNEL_SPECS
  const defaultChannels = isVideo ? DEFAULT_VIDEO_CHANNELS : DEFAULT_PHOTO_CHANNELS
  const channels = requestedChannels ?? defaultChannels

  for (const c of channels) {
    if (!specMap[c]) {
      return res.status(400).json({ error: 'invalid_channel', channel: c, kind: asset.kind })
    }
  }

  let staffName = ''
  if (asset.staff_id) {
    const cRes = await sb(`staff?id=eq.${asset.staff_id}&workspace_id=eq.${ws.id}&select=name`)
    if (cRes.ok) {
      const cRows = await cRes.json()
      staffName = cRows?.[0]?.name || ''
    }
  }

  // --- Render each channel + upload ---
  const renders = []
  const errors = []
  const renderStartedAt = Date.now()

  for (const channel of channels) {
    try {
      const safeFilename = (asset.filename || 'render')
        .replace(/[^\w.-]/g, '_')
        .replace(/\.\w+$/, '')

      if (isPhoto) {
        const { buffer, width, height } = await renderPhotoChannel({
          photoUrl: asset.blob_url,
          channel,
          captionText,
          workspace: ws,
          staffName,
        })
        // Use ws.id (immutable) not ws.slug (mutable) for blob namespacing.
        const pathname = `media/renders/${ws.id}/${asset.id}/${channel}-${safeFilename}.jpg`
        const blob = await blobPut(pathname, buffer, {
          access: 'public',
          contentType: 'image/jpeg',
          addRandomSuffix: false,
          allowOverwrite: true,
        })
        renders.push({ channel, blobUrl: blob.url, width, height, sizeBytes: buffer.length })

      } else {
        // Video — ffmpeg pipeline with Whisper subtitles + brand overlay
        const { buffer, width, height, hadSubtitles } = await renderVideoChannel({
          videoUrl: asset.blob_url,
          channel,
          captionText,
          workspace: ws,
          staffName,
          ...(startSec !== undefined ? { startSec } : {}),
          ...(durationSec !== undefined ? { durationSec } : {}),
          ...(subtitles !== undefined ? { subtitles } : {}),
        })
        // Use ws.id (immutable) not ws.slug (mutable) for blob namespacing.
        const pathname = `media/renders/${ws.id}/${asset.id}/${channel}-${safeFilename}.mp4`
        const blob = await blobPut(pathname, buffer, {
          access: 'public',
          contentType: 'video/mp4',
          addRandomSuffix: false,
          allowOverwrite: true,
        })
        renders.push({ channel, blobUrl: blob.url, width, height, sizeBytes: buffer.length, hadSubtitles })
      }

    } catch (e) {
      console.error(`[render-clip] channel ${channel} failed:`, e?.stack || e?.message || e)
      errors.push({ channel, error: e?.message || 'unknown' })
    }
  }

  const elapsedMs = Date.now() - renderStartedAt

  waitUntil(Promise.resolve()) // placeholder for future analytics logging

  return res.status(renders.length > 0 ? 200 : 500).json({
    assetId,
    kind: asset.kind,
    sourceBlobUrl: asset.blob_url,
    captionText,
    staffName,
    renders,
    errors: errors.length ? errors : undefined,
    elapsedMs,
  })
}
