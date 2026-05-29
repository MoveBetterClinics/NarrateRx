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

import { waitUntil } from '@vercel/functions'
import { requireRole } from '../_lib/auth.js'
import { ALL_KNOWN_ROLES } from '../_lib/roles.js'
import { workspaceContext } from '../_lib/workspaceContext.js'
import { renderAndPatchPackage } from '../_lib/renderPackageChannels.js'

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

  // --- Load package ---
  const pkgRes = await sb(
    `story_packages?id=eq.${packageId}&workspace_id=eq.${ws.id}` +
    `&select=id,staff_id,source_asset_id,topic,caption_text,channels,renders,status`
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
  let staffName = ''
  if (pkg.staff_id) {
    const cRes = await sb(`staff?id=eq.${pkg.staff_id}&workspace_id=eq.${ws.id}&select=name`)
    if (cRes.ok) {
      const cRows = await cRes.json()
      staffName = cRows?.[0]?.name || ''
    }
  }

  const isVideo = asset.kind === 'video'
  const channels = Array.isArray(pkg.channels) && pkg.channels.length
    ? pkg.channels
    : (isVideo ? ['linkedin_video', 'instagram_reel', 'blog_hero_video'] : ['linkedin_feed', 'instagram_reel_still', 'blog_hero'])

  // --- Mark the package as rendering, clearing any prior failure ---
  // The Slate treats status='generating' as in-progress and keeps polling, so
  // the card flips to "complete"/"failed" once the background render settles.
  const claimRes = await sb(`story_packages?id=eq.${packageId}&workspace_id=eq.${ws.id}`, {
    method: 'PATCH',
    body: JSON.stringify({
      caption_text:  newCaption,
      status:        'generating',
      error_message: null,
      updated_at:    new Date().toISOString(),
    }),
  })
  if (!claimRes.ok) {
    const text = await claimRes.text().catch(() => '')
    console.error('[rerender-package] claim patch failed:', claimRes.status, text)
    return res.status(500).json({ error: 'db_patch_failed', detail: text })
  }

  // --- Render off the request path ---
  // A large source (downscaled on ingest) can take minutes to render; holding
  // the HTTP request open raced the 300s function ceiling AND the caller's
  // short-lived Clerk token (→ "invalid-token"). waitUntil keeps the function
  // alive to finish server-side while the client gets an instant 202 and the
  // Slate polls the row for completion.
  waitUntil(
    renderAndPatchPackage({
      workspace:     ws,
      packageId,
      sourceUrl:     asset.blob_url,
      sourceAssetId: pkg.source_asset_id,
      kind:          isVideo ? 'video' : 'photo',
      channels,
      captionText:   newCaption,
      staffName,
      filename:      asset.filename,
      topic:         pkg.topic,
      staffId:   pkg.staff_id || null,
    })
  )

  return res.status(202).json({
    packageId,
    status: 'generating',
    captionText: newCaption,
  })
}
