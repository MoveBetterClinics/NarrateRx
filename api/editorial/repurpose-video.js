// POST /api/editorial/repurpose-video
//
// Repurpose A2 — one-click campaign-bundled repurpose. Creates (or reuses) a
// "Repurpose: <filename>" campaign, kicks the keep-whole long-form master render
// via kickLongformRender (with that campaign tagged), and kicks social-clip
// detection via detectSegmentsForAsset (also tagged). Both backgrounds run off
// the request path; the Slate and the ClipFinder panel each poll their own
// story_packages / segment_status columns.
//
// This replaces the A1 client double-call (renderWholeVideo + findClips) with a
// single auth-checked, campaign-aware server endpoint. The RepurposeAction card
// calls this instead of the two previous helpers.
//
// Body:
//   { assetId: string, maxSegments?: number }
//
// Auth: Clerk JWT + workspace org-id + video_pipeline_enabled.
//
// Responses:
//   202 { campaignId, campaignName, masterPackageId, clipsStatus, mode, channels, durationSec }
//   400 / 401 / 403 / 404 / 409 (clips already detecting) / 500
//
// Idempotency: re-clicking Repurpose on the same source reuses the existing
// campaign (looked up by name + source_asset_id marker in theme_notes). A 409 on
// the clips lane is benign — detection is still in flight from the prior click;
// the master render still kicks (a new package row is created each time since
// the user may have wanted a refresh).

export const config = { runtime: 'nodejs', maxDuration: 300 }

import { waitUntil } from '@vercel/functions'
import { requireRole } from '../_lib/auth.js'
import { ALL_KNOWN_ROLES } from '../_lib/roles.js'
import { workspaceContext } from '../_lib/workspaceContext.js'
import { kickLongformRender, cleanFilename } from '../_lib/kickLongformRender.js'
import { detectSegmentsForAsset } from '../_lib/segmentDetect.js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY

const MAX_SEGMENTS_DEFAULT = 8
const MAX_SEGMENTS_CAP = 12

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

// Build the stable idempotency key embedded in theme_notes so we can find an
// existing campaign for the same source asset without a dedicated column.
function themeTag(assetId) {
  return `source_asset_id:${assetId}`
}

// Create or reuse a "Repurpose: <filename>" campaign for this asset.
// Returns the campaign id.
async function upsertRepurchaseCampaign({ ws, asset, userId }) {
  const campaignName = `Repurpose: ${cleanFilename(asset.filename) || asset.id}`
  const tag = themeTag(asset.id)

  // Look up existing campaigns with this name in the workspace.
  const existingRes = await sb(
    `campaigns?workspace_id=eq.${ws.id}` +
      `&name=eq.${encodeURIComponent(campaignName)}` +
      `&select=id,theme_notes&limit=5`,
  )
  if (existingRes.ok) {
    const rows = await existingRes.json()
    const match = rows.find((c) => (c.theme_notes || '').includes(tag))
    if (match) return match.id
  }

  // Create new campaign.
  const insRes = await sb('campaigns', {
    method: 'POST',
    body: JSON.stringify({
      workspace_id: ws.id,
      name: campaignName,
      description: null,
      status: 'active',
      content_style: 'clinical',
      target_staff_ids: asset.staff_id ? [asset.staff_id] : [],
      // Embed the source asset ID as a stable idempotency marker so
      // re-clicking Repurpose on the same video always reuses this row.
      theme_notes: tag,
      created_by: userId || null,
    }),
  })
  if (!insRes.ok) {
    const errText = await insRes.text().catch(() => '')
    console.error('[repurpose-video] campaign insert failed:', insRes.status, errText)
    throw new Error('campaign_create_failed')
  }
  const campaignId = (await insRes.json())?.[0]?.id
  if (!campaignId) throw new Error('campaign_insert_no_id')
  return campaignId
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
  const assetId = String(body.assetId || '').trim()
  if (!assetId) return res.status(400).json({ error: 'assetId_required' })
  const maxSegments = Math.min(
    Math.max(parseInt(body.maxSegments || String(MAX_SEGMENTS_DEFAULT), 10) || MAX_SEGMENTS_DEFAULT, 1),
    MAX_SEGMENTS_CAP,
  )

  // Fetch the source asset (workspace-scoped). Pull the same columns both
  // render-longform and find-clips need.
  const aRes = await sb(
    `media_assets?id=eq.${assetId}&workspace_id=eq.${ws.id}` +
      `&select=id,kind,blob_url,filename,staff_id,visual_narrative,archived_at,segment_status&limit=1`,
  )
  if (!aRes.ok) return res.status(500).json({ error: 'db_error' })
  const asset = (await aRes.json())?.[0]

  if (!asset) return res.status(404).json({ error: 'asset_not_found' })
  if (asset.archived_at) return res.status(404).json({ error: 'asset_archived' })
  if (asset.kind !== 'video') {
    return res.status(415).json({ error: 'unsupported_asset_kind', kind: asset.kind })
  }
  if (!asset.blob_url) return res.status(500).json({ error: 'asset_missing_blob_url' })

  // Create or reuse the repurpose campaign.
  let campaignId
  const campaignName = `Repurpose: ${cleanFilename(asset.filename) || asset.id}`
  try {
    campaignId = await upsertRepurchaseCampaign({ ws, asset, userId: auth.userId })
  } catch (e) {
    console.error('[repurpose-video] campaign upsert failed:', e?.message || e)
    return res.status(500).json({ error: e?.message || 'campaign_failed' })
  }

  // Origin for chunk engine self-continuation (Node runtime headers).
  const proto = req.headers['x-forwarded-proto'] || 'https'
  const baseUrl = req.headers.host ? `${proto}://${req.headers.host}` : null

  // Kick the master long-form render (tagged to campaign).
  let masterResult
  try {
    masterResult = await kickLongformRender({ ws, asset, baseUrl, campaignId })
  } catch (e) {
    console.error('[repurpose-video] kickLongformRender failed:', e?.message || e)
    return res.status(500).json({ error: e?.message || 'master_render_failed' })
  }

  // Kick clip detection (tagged to campaign). Mirrors find-clips.js logic:
  // mark 'detecting' up-front, run detectSegmentsForAsset off the request path.
  // A 'detecting' status means detection is already in flight — still benign
  // since the master render started successfully.
  let clipsStatus = 'detecting'
  if (asset.segment_status === 'detecting') {
    // Already detecting from a prior click — don't double-kick.
    clipsStatus = 'already_detecting'
  } else {
    const patchRes = await sb(
      `media_assets?id=eq.${assetId}&workspace_id=eq.${ws.id}`,
      { method: 'PATCH', body: JSON.stringify({ segment_status: 'detecting', segment_error: null }) },
    )
    if (!patchRes.ok) {
      // Non-fatal: the master render is kicked, clips just won't detect this
      // time. Log and continue so the user at least gets the master.
      console.error('[repurpose-video] segment_status patch failed:', patchRes.status)
      clipsStatus = 'detection_skipped'
    } else {
      waitUntil(
        detectSegmentsForAsset({ workspace: ws, asset, maxSegments, campaignId }),
      )
    }
  }

  return res.status(202).json({
    campaignId,
    campaignName,
    masterPackageId: masterResult.packageId,
    clipsStatus,
    mode: masterResult.mode,
    channels: masterResult.channels,
    durationSec: masterResult.durationSec,
    ...(masterResult.mode === 'chunked' ? { chunks: masterResult.chunks } : {}),
  })
}
