// api/_lib/kickLongformRender.js
//
// Shared helper: create a keep-whole long-form story package row, probe the
// source duration, plan chunks if needed, and kick the render off the request
// path via waitUntil. Called by:
//   - api/editorial/render-longform.js  (direct "Full video" button, campaignId=null)
//   - api/editorial/repurpose-video.js  (Repurpose A2, campaignId from created campaign)
//
// @param {Object} p
// @param {Object} p.ws          — workspace row (id + all brand/voice fields)
// @param {Object} p.asset       — media_assets row (id, blob_url, filename,
//                                  staff_id, visual_narrative)
// @param {string|null} p.baseUrl  — origin for chunk engine self-continuation
//                                   (req.headers.host derived)
// @param {string|null} [p.campaignId] — optional campaign to tag the package with
// @returns {Promise<{ packageId: string, mode: 'chunked'|'single', channels: string[],
//                     durationSec: number|null, chunks: number }>}

import { waitUntil } from '@vercel/functions'
import { renderAndPatchPackage } from './renderPackageChannels.js'
import { generateCaption } from './captionGen.js'
import { probeDurationSec } from './ffprobeDuration.js'
import { planChunks, SINGLE_PASS_MAX_SECONDS } from './renderChunkPlan.js'
import { runChunkPass } from './longformEngine.js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY

// Long-form landscape channels. All 16:9, fit:'contain' (keep whole frame),
// longform:true (120s budget). website_embed excluded until the website-publish
// path supports rendered video output — see render-longform.js comments.
const LONGFORM_CHANNELS = ['youtube', 'linkedin_native']

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

// Turn a source filename into a readable topic when no visual_narrative exists.
export function cleanFilename(filename) {
  return String(filename || '')
    .replace(/\.\w+$/, '')         // drop extension
    .replace(/[_-]+/g, ' ')        // separators → spaces
    .replace(/\s+/g, ' ')
    .trim()
}

export async function kickLongformRender({ ws, asset, baseUrl, campaignId = null }) {
  const staffId = asset.staff_id || null

  // Resolve clinician name once for the lower-third overlay (best-effort).
  let staffName = ''
  if (staffId) {
    const cRes = await sb(`staff?id=eq.${staffId}&workspace_id=eq.${ws.id}&select=name`)
    if (cRes.ok) {
      const rows = await cRes.json()
      staffName = rows?.[0]?.name || ''
    }
  }

  // Topic = the asset's visual narrative when present, else a cleaned filename.
  const topic =
    (asset.visual_narrative || '').trim() ||
    cleanFilename(asset.filename) ||
    'Full-length video'

  // Voice-faithful caption via the shared generator. Non-fatal: fall back to
  // the topic so a model hiccup never blocks the render.
  let captionText = ''
  try {
    captionText = await generateCaption({
      topic,
      clip: { visualNarrative: asset.visual_narrative || '' },
      workspace: ws,
      staffId,
    })
  } catch (e) {
    console.error('[kickLongformRender] caption gen failed:', e?.message || e)
    captionText = topic.slice(0, 500)
  }
  captionText = String(captionText || '').slice(0, 500)

  // Create the story package row (status='generating') so the Slate card
  // appears immediately with a spinner. campaign_id wires this package into
  // the repurpose campaign (null for standalone renders).
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
      ...(campaignId ? { campaign_id: campaignId } : {}),
    }),
  })
  if (!insRes.ok) {
    const errText = await insRes.text().catch(() => '')
    console.error('[kickLongformRender] package insert failed:', insRes.status, errText)
    throw new Error('db_insert_failed')
  }
  const packageId = (await insRes.json())?.[0]?.id
  if (!packageId) throw new Error('insert_no_id')

  // Decide single-pass vs chunked from the source duration. Probing reads only
  // the container header (no download), so it's cheap even for a multi-GB talk.
  const durationSec = await probeDurationSec(asset.blob_url)

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
    const chunkRes = await sb('story_package_chunks', {
      method: 'POST',
      body: JSON.stringify(rows),
    })
    if (chunkRes.ok) {
      chunkRowsCreated = rows.length
    } else {
      // Graceful degradation: if chunk row creation fails (e.g. migration not
      // applied), fall back to the capped single-pass render.
      const errText = await chunkRes.text().catch(() => '')
      console.error(
        '[kickLongformRender] chunk insert failed, falling back to single-pass:',
        chunkRes.status, errText,
      )
    }
  }

  if (chunkRowsCreated > 0) {
    waitUntil(runChunkPass({ packageId, baseUrl }))
    return {
      packageId,
      mode: 'chunked',
      channels: LONGFORM_CHANNELS,
      durationSec,
      chunks: chunkRowsCreated,
    }
  }

  // Single-pass path — short source (≤ cap) or chunk setup unavailable.
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

  return {
    packageId,
    mode: 'single',
    channels: LONGFORM_CHANNELS,
    durationSec: durationSec ?? null,
    chunks: 0,
  }
}
