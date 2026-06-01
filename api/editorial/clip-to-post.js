// POST /api/editorial/clip-to-post
//
// Slate clip workshop — "As a post" output.
//
// Takes a rendered clip blob URL and creates a content_items draft so the
// clip flows into the normal Storyboard → publish pipeline.
// Slate never publishes directly.
//
// Body: { assetId, renderedBlobUrl, captionText, platform }
//
// Response 200: { contentItemId }
// Errors: 400 / 401 / 403 / 404 / 409 (consent blocked) / 500

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

const VALID_PLATFORMS = [
  'linkedin', 'instagram', 'facebook', 'tiktok', 'youtube', 'gbp', 'blog', 'email',
]

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

  const { assetId, renderedBlobUrl, captionText = '', platform } = req.body || {}
  if (!assetId) return res.status(400).json({ error: 'assetId_required' })
  if (!renderedBlobUrl) return res.status(400).json({ error: 'renderedBlobUrl_required' })
  if (!platform || !VALID_PLATFORMS.includes(platform)) {
    return res.status(400).json({ error: 'invalid_platform', valid: VALID_PLATFORMS })
  }

  // Fetch source asset — must belong to this workspace
  const assetRes = await sb(
    `media_assets?id=eq.${assetId}&workspace_id=eq.${ws.id}&select=id,staff_id,consent_status`
  )
  if (!assetRes.ok) return res.status(500).json({ error: 'db_error' })
  const assets = await assetRes.json()
  const asset = assets?.[0]
  if (!asset) return res.status(404).json({ error: 'asset_not_found' })

  // Consent gate — enforced server-side, not just UI
  if (asset.consent_status === 'pending') {
    return res.status(409).json({
      error: 'consent_pending',
      message: 'Source asset is awaiting consent. Resolve consent before creating a post.',
    })
  }
  if (asset.consent_status === 'revoked') {
    return res.status(409).json({
      error: 'consent_revoked',
      message: 'Source asset consent has been revoked. This clip cannot be used.',
    })
  }

  const caption = String(captionText || '').slice(0, 2000)

  const row = {
    workspace_id: ws.id,
    status:       'draft',
    platform,
    media_urls:   [{ url: renderedBlobUrl, type: 'video', kind: 'video', mediaAssetId: assetId }],
    content:      caption,
    overlay_text: caption,
    staff_id:     asset.staff_id || null,
    notes:        `Slate clip from asset ${assetId}`,
  }

  const insertRes = await sb('content_items', {
    method: 'POST',
    body: JSON.stringify(row),
  })
  if (!insertRes.ok) {
    const text = await insertRes.text().catch(() => '')
    console.error('[clip-to-post] content_items insert failed:', insertRes.status, text)
    return res.status(500).json({ error: 'insert_failed', detail: text })
  }
  const items = await insertRes.json()
  const contentItemId = items?.[0]?.id
  if (!contentItemId) {
    return res.status(500).json({ error: 'insert_returned_no_id' })
  }

  return res.status(200).json({ contentItemId })
}
