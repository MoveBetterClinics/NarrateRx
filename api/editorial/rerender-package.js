// POST /api/editorial/rerender-package
//
// Phase 3 PR 3: Re-render a story package's channel outputs with an updated caption.
// Used by the inline edit flow on the Story Slate when the clinician changes the caption
// and wants the visual renders updated to match.
//
// Body:
//   {
//     packageId: string,          // required
//     captionText?: string,       // new caption; if omitted, re-renders with existing caption
//   }
//
// Flow:
//   1. Load story_package (must be complete, not approved)
//   2. Load source media_asset for blobUrl + kind
//   3. Load clinician name
//   4. Re-render all channels (same channel list as original)
//   5. PATCH story_packages: new renders + caption_text + status='complete'
//   6. Return updated package fields
//
// Auth: all roles, workspace-scoped.
// maxDuration: 300s (renders can take ~60s per channel).

export const config = { runtime: 'nodejs', maxDuration: 300 }

import { put as blobPut } from '@vercel/blob'
import { waitUntil } from '@vercel/functions'
import { requireRole } from '../_lib/auth.js'
import { ALL_KNOWN_ROLES } from '../_lib/roles.js'
import { workspaceContext } from '../_lib/workspaceContext.js'
import { renderPhotoChannel, CHANNEL_SPECS } from '../_lib/brandRender.js'
import { renderVideoChannel, VIDEO_CHANNEL_SPECS } from '../_lib/brandRenderVideo.js'
import { scoreCaptionFidelity } from '../_lib/captionFidelity.js'

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

  const { packageId, captionText } = req.body || {}
  if (!packageId) return res.status(400).json({ error: 'packageId_required' })

  const started = Date.now()

  // --- Load package ---
  const pkgRes = await sb(
    `story_packages?id=eq.${packageId}&workspace_id=eq.${ws.id}` +
    `&select=id,clinician_id,source_asset_id,topic,caption_text,channels,renders,status`
  )
  if (!pkgRes.ok) return res.status(500).json({ error: 'db_error' })
  const pkgs = await pkgRes.json()
  const pkg = pkgs?.[0]
  if (!pkg) return res.status(404).json({ error: 'package_not_found' })
  if (pkg.status === 'approved') {
    return res.status(409).json({ error: 'already_approved', message: 'Cannot re-render an approved package.' })
  }

  const newCaption = (typeof captionText === 'string' && captionText.trim())
    ? captionText.trim().slice(0, 1000)
    : pkg.caption_text

  // --- Load source media asset ---
  if (!pkg.source_asset_id) {
    return res.status(409).json({ error: 'no_source_asset', message: 'Package has no source asset to re-render from.' })
  }
  const assetRes = await sb(
    `media_assets?id=eq.${pkg.source_asset_id}&workspace_id=eq.${ws.id}&select=id,kind,blob_url,thumbnail_url,filename`
  )
  if (!assetRes.ok) return res.status(500).json({ error: 'db_error' })
  const assets = await assetRes.json()
  const asset = assets?.[0]
  if (!asset || !asset.blob_url) {
    return res.status(404).json({ error: 'source_asset_not_found' })
  }

  // --- Load clinician name ---
  let clinicianName = ''
  if (pkg.clinician_id) {
    const cRes = await sb(`clinicians?id=eq.${pkg.clinician_id}&workspace_id=eq.${ws.id}&select=name`)
    if (cRes.ok) {
      const cRows = await cRes.json()
      clinicianName = cRows?.[0]?.name || ''
    }
  }

  const isVideo = asset.kind === 'video'
  const channels = Array.isArray(pkg.channels) && pkg.channels.length
    ? pkg.channels
    : (isVideo ? ['linkedin_video', 'instagram_reel', 'blog_hero_video'] : ['linkedin_feed', 'instagram_reel_still', 'blog_hero'])

  const safeFilename = (asset.filename || 'render')
    .replace(/[^\w.-]/g, '_')
    .replace(/\.\w+$/, '')

  // --- Re-render all channels ---
  const renders = []
  const errors = []

  for (const channel of channels) {
    try {
      if (isVideo) {
        if (!VIDEO_CHANNEL_SPECS[channel]) { errors.push({ channel, error: 'unknown_channel' }); continue }
        const { buffer, width, height, hadSubtitles } = await renderVideoChannel({
          videoUrl: asset.blob_url,
          channel,
          captionText: newCaption,
          workspace: ws,
          clinicianName,
        })
        const pathname = `media/renders/${ws.slug}/${pkg.source_asset_id}/${channel}-${safeFilename}.mp4`
        const blob = await blobPut(pathname, buffer, {
          access: 'public', contentType: 'video/mp4', addRandomSuffix: false, allowOverwrite: true,
        })
        renders.push({ channel, blobUrl: blob.url, width, height, sizeBytes: buffer.length, hadSubtitles })
      } else {
        if (!CHANNEL_SPECS[channel]) { errors.push({ channel, error: 'unknown_channel' }); continue }
        const { buffer, width, height } = await renderPhotoChannel({
          photoUrl: asset.blob_url,
          channel,
          captionText: newCaption,
          workspace: ws,
          clinicianName,
        })
        const pathname = `media/renders/${ws.slug}/${pkg.source_asset_id}/${channel}-${safeFilename}.jpg`
        const blob = await blobPut(pathname, buffer, {
          access: 'public', contentType: 'image/jpeg', addRandomSuffix: false, allowOverwrite: true,
        })
        renders.push({ channel, blobUrl: blob.url, width, height, sizeBytes: buffer.length })
      }
    } catch (e) {
      console.error(`[rerender-package] channel ${channel} failed:`, e?.stack || e?.message || e)
      errors.push({ channel, error: e?.message || 'unknown' })
    }
  }

  if (renders.length === 0) {
    return res.status(500).json({ error: 'all_channels_failed', errors })
  }

  // --- Patch package with new renders + caption ---
  const finalStatus = renders.length > 0 ? 'complete' : 'failed'
  const patchRes = await sb(`story_packages?id=eq.${packageId}&workspace_id=eq.${ws.id}`, {
    method: 'PATCH',
    body: JSON.stringify({
      caption_text: newCaption,
      renders,
      status: finalStatus,
      updated_at: new Date().toISOString(),
    }),
  })
  if (!patchRes.ok) {
    const text = await patchRes.text().catch(() => '')
    console.error('[rerender-package] patch failed:', patchRes.status, text)
    return res.status(500).json({ error: 'db_patch_failed', detail: text })
  }
  const updated = await patchRes.json()

  // Background re-score now that the caption text + renders have changed.
  if (finalStatus === 'complete') {
    waitUntil(
      scoreCaptionFidelity({
        packageId,
        workspaceId:   ws.id,
        workspaceName: ws.display_name,
        clinicianId:   pkg.clinician_id || null,
        topic:         pkg.topic,
        captionText:   newCaption,
      }).catch((e) => {
        console.error('[rerender-package] caption fidelity scoring failed:', e?.message || e)
      })
    )
  }

  return res.status(200).json({
    packageId,
    captionText: newCaption,
    renders,
    errors: errors.length ? errors : undefined,
    elapsedMs: Date.now() - started,
    package: updated?.[0],
  })
}
