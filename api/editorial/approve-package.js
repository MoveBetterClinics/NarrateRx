// POST /api/editorial/approve-package
//
// Approve a story package from the Story Director Slate.
//
// Body: { packageId: string, destination?: 'publish' | 'library' }
//
// destination='publish' (default): creates one content_items row per unique platform,
//   grouping channels that share a platform (e.g. linkedin_feed + linkedin_video → one
//   'linkedin' row). Response: { contentItems, packageId, platformCount }
//
// destination='library': creates one media_assets row per render, returning clips to
//   the Library for reuse in future posts. Response: { assets, packageId, assetCount }
//
// Both paths mark the story_package as 'approved'.
//
// Errors: 400 / 401 / 403 / 404 / 409 (already approved) / 500
// Auth: all roles (clinicians approve their own packages).
// Requires migration 090 (status constraint expansion) applied before use.

export const config = { runtime: 'nodejs' }

import { requireRole } from '../_lib/auth.js'
import { ALL_KNOWN_ROLES } from '../_lib/roles.js'
import { workspaceContext } from '../_lib/workspaceContext.js'
import { saveSlateBroll } from '../_lib/saveSlateBroll.js'

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

// Map render channel IDs → the platform string used in content_items.
const CHANNEL_TO_PLATFORM = {
  linkedin_feed:         'linkedin',
  linkedin_video:        'linkedin',
  linkedin_native:       'linkedin',   // keep-whole long-form (16:9 landscape video)
  instagram_reel_still:  'instagram',
  instagram_reel:        'instagram',
  instagram_feed:        'instagram',
  blog_hero:             'blog',
  blog_hero_video:       'blog',
  tiktok_still:          'tiktok',
  tiktok:                'tiktok',
  youtube_short:         'youtube',
  youtube:               'youtube',     // keep-whole long-form (16:9 landscape video)
  facebook_feed:         'facebook',
  facebook_video:        'facebook',
  gbp_post:              'gbp',
  // NOTE: 'website_embed' is intentionally unmapped — the long-form website
  // version is a download-only render (no auto-publish target). Routing it to
  // the website/blog path is a deferred follow-up.
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

  const { packageId, destination = 'publish' } = req.body || {}
  if (!packageId) return res.status(400).json({ error: 'packageId_required' })
  if (destination !== 'publish' && destination !== 'library') {
    return res.status(400).json({ error: 'invalid_destination', message: "destination must be 'publish' or 'library'" })
  }

  // --- Load package + source asset consent state (must belong to this workspace) ---
  const pkgRes = await sb(
    `story_packages?id=eq.${packageId}&workspace_id=eq.${ws.id}` +
    `&select=id,workspace_id,staff_id,source_asset_id,topic,caption_text,similarity,channels,renders,status,source_asset:media_assets(consent_status)`
  )
  if (!pkgRes.ok) return res.status(500).json({ error: 'db_error' })
  const pkgs = await pkgRes.json()
  const pkg = pkgs?.[0]
  if (!pkg) return res.status(404).json({ error: 'package_not_found' })
  if (pkg.status === 'approved') {
    return res.status(409).json({ error: 'already_approved', message: 'This package has already been approved.' })
  }
  if (pkg.status !== 'complete') {
    return res.status(409).json({ error: 'not_complete', message: 'Package must be in complete status before approving.' })
  }

  // --- Consent gate: block if source asset is flagged pending or revoked ---
  const consentStatus = pkg.source_asset?.consent_status
  if (consentStatus === 'pending') {
    return res.status(409).json({
      error: 'consent_pending',
      message: 'Source asset is awaiting consent. Mark consent obtained (or not required) before approving.',
    })
  }
  if (consentStatus === 'revoked') {
    return res.status(409).json({
      error: 'consent_revoked',
      message: 'Source asset consent has been revoked. This package cannot be approved.',
    })
  }

  // --- Resolve clinician name ---
  let staffName = ''
  if (pkg.staff_id) {
    const cRes = await sb(`staff?id=eq.${pkg.staff_id}&workspace_id=eq.${ws.id}&select=name`)
    if (cRes.ok) {
      const cRows = await cRes.json()
      staffName = cRows?.[0]?.name || ''
    }
  }

  // --- Group renders by platform ---
  const renders = Array.isArray(pkg.renders) ? pkg.renders : []
  const byPlatform = {}
  for (const render of renders) {
    const platform = CHANNEL_TO_PLATFORM[render.channel]
    if (!platform) continue
    if (!byPlatform[platform]) byPlatform[platform] = { platform, renders: [] }
    byPlatform[platform].renders.push(render)
  }

  if (renders.length === 0) {
    return res.status(409).json({
      error: 'no_renders',
      message: 'Package has no rendered outputs to stage.',
    })
  }

  if (destination === 'publish' && Object.keys(byPlatform).length === 0) {
    return res.status(409).json({
      error: 'no_renders',
      message: 'Package has no rendered outputs to stage.',
    })
  }

  const now = new Date().toISOString()

  if (destination === 'library') {
    // Each rendered clip lands in the Library as reusable broll for future posts.
    // saveSlateBroll handles the media_assets insert + waitUntil(indexMediaAsset).
    let assets
    try {
      assets = await saveSlateBroll({
        ws,
        renders,
        staffId: pkg.staff_id || null,
        notes: `${pkg.topic} · package ${packageId}`,
        parentAssetId: pkg.source_asset_id || null,
      })
    } catch (e) {
      console.error('[approve-package] saveSlateBroll failed:', e.message)
      return res.status(500).json({ error: 'media_assets_insert_failed', detail: e.message })
    }

    const libraryPatchRes = await sb(`story_packages?id=eq.${packageId}&workspace_id=eq.${ws.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'approved', updated_at: now }),
    })
    if (!libraryPatchRes.ok) {
      const txt = await libraryPatchRes.text().catch(() => '')
      console.error('[approve-package] status patch failed:', libraryPatchRes.status, txt)
      return res.status(500).json({ error: 'status_patch_failed', detail: txt })
    }

    return res.status(200).json({
      packageId,
      destination: 'library',
      assets,
      assetCount: assets.length,
    })
  }

  // --- destination === 'publish': insert one content_items row per platform ---
  const rows = Object.values(byPlatform).map(({ platform, renders: pRenders }) => ({
    workspace_id:   ws.id,
    interview_id:   null,
    staff_id:       pkg.staff_id || null,
    staff_name:     staffName,
    topic:          pkg.topic,
    platform,
    content:        pkg.caption_text,
    overlay_text:   pkg.caption_text,
    // Canonical media_urls shape is [{url, type, kind}] — NOT bare strings.
    // The Buffer publish path (prepareMediaForBuffer / buildAssets) keys video
    // detection off `m.type`, and the Drafts UI reads `m.url`. Bare strings
    // would publish a long-form (.mp4) render as a broken image. Derive video
    // vs image from the render extension (video renders are .mp4, photos .jpg).
    media_urls:     pRenders.map((r) => {
      const isVideo = String(r.blobUrl || '').toLowerCase().endsWith('.mp4')
      return { url: r.blobUrl, type: isVideo ? 'video' : 'image', kind: isVideo ? 'video' : 'image' }
    }),
    status:         'approved',
    approved_at:    now,
    notes:          `Approved from Story Slate (package ${packageId})`,
    provenance:     {
      source:       'story_package',
      package_id:   packageId,
      similarity:   pkg.similarity,
      channels:     pRenders.map((r) => r.channel),
    },
  }))

  // Idempotency guard: if content_items already exist for this package, a prior approve
  // wrote them but the PATCH to 'approved' failed. Skip the insert, fix the status, and
  // return the existing rows — prevents duplicates on client retry.
  const existRes = await sb(
    `content_items?workspace_id=eq.${ws.id}&provenance->>package_id=eq.${packageId}` +
    `&select=id,platform,media_urls,status,content,approved_at,provenance`
  )
  if (existRes.ok) {
    const existingItems = await existRes.json()
    if (existingItems?.length > 0) {
      const fixPatch = await sb(`story_packages?id=eq.${packageId}&workspace_id=eq.${ws.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'approved', updated_at: now }),
      })
      if (!fixPatch.ok) {
        const txt = await fixPatch.text().catch(() => '')
        console.error('[approve-package] status patch failed (retry):', fixPatch.status, txt)
        return res.status(500).json({ error: 'status_patch_failed', detail: txt })
      }
      return res.status(200).json({ packageId, destination: 'publish', contentItems: existingItems, platformCount: existingItems.length })
    }
  }

  const insertRes = await sb('content_items', {
    method: 'POST',
    body: JSON.stringify(rows),
  })
  if (!insertRes.ok) {
    const text = await insertRes.text().catch(() => '')
    console.error('[approve-package] content_items insert failed:', insertRes.status, text)
    return res.status(500).json({ error: 'content_items_insert_failed', detail: text })
  }
  const contentItems = await insertRes.json()

  const publishPatchRes = await sb(`story_packages?id=eq.${packageId}&workspace_id=eq.${ws.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ status: 'approved', updated_at: now }),
  })
  if (!publishPatchRes.ok) {
    const txt = await publishPatchRes.text().catch(() => '')
    console.error('[approve-package] status patch failed:', publishPatchRes.status, txt)
    return res.status(500).json({ error: 'status_patch_failed', detail: txt })
  }

  return res.status(200).json({
    packageId,
    destination: 'publish',
    contentItems,
    platformCount: contentItems.length,
  })
}
