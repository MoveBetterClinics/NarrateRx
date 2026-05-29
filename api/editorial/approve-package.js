// POST /api/editorial/approve-package
//
// Phase 3 PR 2: Approve a story package from the Story Director Slate.
//
// Creates one content_items row per unique platform (grouping channels that
// share the same platform: e.g. linkedin_feed + linkedin_video → one 'linkedin'
// row with both render URLs). Then marks the story_package as 'approved'.
//
// Body: { packageId: string }
//
// Response 200: { contentItems: [{ id, platform, ... }], packageId }
// Errors: 400 / 401 / 403 / 404 / 409 (already approved) / 500
//
// Auth: all roles (clinicians approve their own packages).
// Requires migration 090 (status constraint expansion) applied before use.

export const config = { runtime: 'nodejs' }

import { requireRole } from '../_lib/auth.js'
import { ALL_KNOWN_ROLES } from '../_lib/roles.js'
import { workspaceContext } from '../_lib/workspaceContext.js'

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
  instagram_reel_still:  'instagram',
  instagram_reel:        'instagram',
  instagram_feed:        'instagram',
  blog_hero:             'blog',
  blog_hero_video:       'blog',
  tiktok_still:          'tiktok',
  tiktok:                'tiktok',
  youtube_short:         'youtube',
  facebook_feed:         'facebook',
  facebook_video:        'facebook',
  gbp_post:              'gbp',
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

  const { packageId } = req.body || {}
  if (!packageId) return res.status(400).json({ error: 'packageId_required' })

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

  if (Object.keys(byPlatform).length === 0) {
    return res.status(409).json({
      error: 'no_renders',
      message: 'Package has no rendered outputs to stage.',
    })
  }

  // --- Insert one content_items row per platform ---
  const now = new Date().toISOString()
  const rows = Object.values(byPlatform).map(({ platform, renders: pRenders }) => ({
    workspace_id:   ws.id,
    interview_id:   null,
    staff_id:   pkg.staff_id || null,
    staff_name: staffName,
    topic:          pkg.topic,
    platform,
    content:        pkg.caption_text,
    overlay_text:   pkg.caption_text,
    media_urls:     pRenders.map((r) => r.blobUrl),
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

  // --- Mark package approved ---
  await sb(`story_packages?id=eq.${packageId}&workspace_id=eq.${ws.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ status: 'approved', updated_at: now }),
  }).catch((e) => {
    console.error('[approve-package] status patch failed:', e.message)
  })

  return res.status(200).json({
    packageId,
    contentItems,
    platformCount: contentItems.length,
  })
}
