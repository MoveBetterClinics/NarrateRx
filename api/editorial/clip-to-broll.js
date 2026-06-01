// POST /api/editorial/clip-to-broll
//
// Slate clip workshop — "Library b-roll" output.
//
// Saves a rendered clip as a media_assets broll row and kicks off
// visual-memory indexing so it surfaces in ranked Suggested media.
//
// Body: { assetId, renderedBlobUrl, width?, height?, sizeBytes?, captionText? }
//
// Response 200: { assetId: <new media_assets.id> }
// Errors: 400 / 401 / 403 / 404 / 409 (consent blocked) / 500

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

  const { assetId, renderedBlobUrl, width, height, sizeBytes, captionText = '' } = req.body || {}
  if (!assetId) return res.status(400).json({ error: 'assetId_required' })
  if (!renderedBlobUrl) return res.status(400).json({ error: 'renderedBlobUrl_required' })

  // Fetch source asset — must belong to this workspace
  const assetRes = await sb(
    `media_assets?id=eq.${assetId}&workspace_id=eq.${ws.id}&select=id,staff_id,consent_status,filename`
  )
  if (!assetRes.ok) return res.status(500).json({ error: 'db_error' })
  const assets = await assetRes.json()
  const asset = assets?.[0]
  if (!asset) return res.status(404).json({ error: 'asset_not_found' })

  // Consent gate — enforced server-side
  if (asset.consent_status === 'pending') {
    return res.status(409).json({
      error: 'consent_pending',
      message: 'Source asset is awaiting consent. Resolve consent before saving to Library.',
    })
  }
  if (asset.consent_status === 'revoked') {
    return res.status(409).json({
      error: 'consent_revoked',
      message: 'Source asset consent has been revoked. This clip cannot be saved.',
    })
  }

  let savedAssets
  try {
    savedAssets = await saveSlateBroll({
      ws,
      renders: [{ blobUrl: renderedBlobUrl, width: width || null, height: height || null, sizeBytes: sizeBytes || null }],
      staffId: asset.staff_id || null,
      notes: `Slate clip from asset ${assetId}${captionText ? ` — "${String(captionText).slice(0, 80)}"` : ''}`,
      parentAssetId: assetId,
    })
  } catch (e) {
    console.error('[clip-to-broll] saveSlateBroll failed:', e.message)
    return res.status(500).json({ error: 'insert_failed', detail: e.message })
  }

  return res.status(200).json({ assetId: savedAssets[0]?.id })
}
