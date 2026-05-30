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

export const config = { runtime: 'nodejs', maxDuration: 300 }

import { waitUntil } from '@vercel/functions'
import { requireRole } from '../_lib/auth.js'
import { ALL_KNOWN_ROLES } from '../_lib/roles.js'
import { workspaceContext } from '../_lib/workspaceContext.js'
import { renderAndPatchPackage } from '../_lib/renderPackageChannels.js'
import { generateCaption } from '../_lib/captionGen.js'
import { probeDurationSec } from '../_lib/ffprobeDuration.js'
import { planChunks, SINGLE_PASS_MAX_SECONDS } from '../_lib/renderChunkPlan.js'
import { runChunkPass } from '../_lib/longformEngine.js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY

// Long-form landscape channels (PR #999). All 16:9, fit:'contain' (keep whole
// frame), longform:true (120s budget). The render derives keep-whole from these.
// website_embed excluded: approve-package.js has no CHANNEL_TO_PLATFORM entry for
// it yet, so rendered .mp4s would be orphaned in Blob with no content_items row.
// Re-add once the website-publish path is implemented.
const LONGFORM_CHANNELS = ['youtube', 'linkedin_native']

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

// Turn a source filename into a readable topic when no visual_narrative exists.
function cleanFilename(filename) {
  return String(filename || '')
    .replace(/\.\w+$/, '')        // drop extension
    .replace(/[_-]+/g, ' ')        // separators → spaces
    .replace(/\s+/g, ' ')
    .trim()
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

  // Fetch the source asset (workspace-scoped) — same columns render-segments
  // pulls, plus visual_narrative for the caption topic.
  const aRes = await sb(
    `media_assets?id=eq.${assetId}&workspace_id=eq.${ws.id}` +
      `&select=id,kind,blob_url,filename,staff_id,visual_narrative,archived_at&limit=1`,
  )
  if (!aRes.ok) return res.status(500).json({ error: 'db_error' })
  const asset = (await aRes.json())?.[0]

  if (!asset) return res.status(404).json({ error: 'asset_not_found' })
  if (asset.kind !== 'video' || !asset.blob_url || asset.archived_at) {
    return res.status(400).json({ error: 'invalid_source' })
  }

  const staffId = asset.staff_id || null

  // Resolve clinician name once for the lower-third overlay (best-effort).
  let staffName = ''
  if (staffId) {
    const cRes = await sb(`staff?id=eq.${staffId}&workspace_id=eq.${ws.id}&select=name`)
    if (cRes.ok) {
      const cRows = await cRes.json()
      staffName = cRows?.[0]?.name || ''
    }
  }

  // Topic = the asset's visual narrative when present, else a cleaned filename.
  const topic = (asset.visual_narrative || '').trim() || cleanFilename(asset.filename) || 'Full-length video'

  // Voice-faithful caption via the shared generator (PR #997 logic). Non-fatal:
  // fall back to the topic so a model hiccup never blocks the render.
  let captionText = ''
  try {
    captionText = await generateCaption({
      topic,
      clip: { visualNarrative: asset.visual_narrative || '' },
      workspace: ws,
      staffId,
    })
  } catch (e) {
    console.error('[render-longform] caption gen failed:', e?.message || e)
    captionText = topic.slice(0, 500)
  }
  captionText = String(captionText || '').slice(0, 500)

  // Create the story package row (status='generating') so the Slate card
  // appears immediately with a spinner. channels = the long-form landscape set,
  // which is what makes the render keep-whole.
  const insRes = await sb('story_packages', {
    method: 'POST',
    body: JSON.stringify({
      workspace_id: ws.id,
      staff_id: staffId,
      source_asset_id: asset.id,
      topic,
      caption_text: captionText,
      similarity: null,
      channels: LONGFORM_CHANNELS,
      renders: [],
      status: 'generating',
    }),
  })
  if (!insRes.ok) {
    const errText = await insRes.text().catch(() => '')
    console.error('[render-longform] package insert failed:', insRes.status, errText)
    return res.status(500).json({ error: 'db_insert_failed' })
  }
  const packageId = (await insRes.json())?.[0]?.id
  if (!packageId) return res.status(500).json({ error: 'insert_no_id' })

  // Origin for the chunk engine's self-continuation POSTs (Node runtime headers).
  const proto = req.headers['x-forwarded-proto'] || 'https'
  const baseUrl = req.headers.host ? `${proto}://${req.headers.host}` : null

  // Decide single-pass vs chunked from the source duration. Probing reads only
  // the container header (no download), so it's cheap even for a multi-GB talk.
  const durationSec = await probeDurationSec(asset.blob_url)

  // Long sources (> the single-pass cap) render piece-by-piece across many
  // function invocations and are concatenated into one master — this is what
  // removes the old ~2–4 min ceiling for 30–60 min talks. We plan the pieces +
  // create their rows here, then kick the first engine pass off the request
  // path; the chain self-continues and a cron net resumes any dropped hand-off.
  const wantsChunked = durationSec && durationSec > SINGLE_PASS_MAX_SECONDS
  let chunkRowsCreated = 0
  if (wantsChunked) {
    const plan = planChunks(durationSec)
    const rows = plan.map((c) => ({
      workspace_id: ws.id,
      package_id: packageId,
      idx: c.idx,
      start_sec: c.startSec,
      dur_sec: c.durSec,
      status: 'pending',
    }))
    const chunkRes = await sb('story_package_chunks', { method: 'POST', body: JSON.stringify(rows) })
    if (chunkRes.ok) {
      chunkRowsCreated = rows.length
    } else {
      // Graceful degradation: if piece-row creation fails (e.g. migration not
      // applied), fall back to the capped single-pass render rather than 500.
      // The producer still gets the first ~4 min instead of a hard failure.
      const errText = await chunkRes.text().catch(() => '')
      console.error('[render-longform] chunk insert failed, falling back to single-pass:', chunkRes.status, errText)
    }
  }

  if (chunkRowsCreated > 0) {
    // Chunked path — the engine renders pieces, then stitches + completes.
    waitUntil(runChunkPass({ packageId, baseUrl }))
    return res.status(202).json({
      packageId, status: 'generating', channels: LONGFORM_CHANNELS,
      mode: 'chunked', chunks: chunkRowsCreated, durationSec,
    })
  }

  // Single-pass path — short source (≤ cap) or chunk setup unavailable. Renders
  // from 0 up to LONGFORM_MAX_SECONDS. Captions off (long-form default). The
  // Slate polls story_packages until status flips complete/failed.
  waitUntil(
    renderAndPatchPackage({
      workspace: ws,
      packageId,
      sourceUrl: asset.blob_url,
      sourceAssetId: asset.id,
      kind: 'video',
      channels: LONGFORM_CHANNELS,
      captionText,
      staffName,
      filename: asset.filename,
      topic,
      staffId,
      subtitles: false,
    }),
  )

  return res.status(202).json({
    packageId, status: 'generating', channels: LONGFORM_CHANNELS,
    mode: 'single', durationSec: durationSec ?? null,
  })
}
