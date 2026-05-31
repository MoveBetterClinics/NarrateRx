// POST /api/editorial/generate-package
//
// Phase 2 Day 8 of the 30-day video output build.
// V6 upgrade: clip search is now framing-aware when ws.rag_fusion_enabled.
//
// Body:
//   {
//     topic: string,              // required — e.g. "spinal manipulation technique"
//     captionText?: string,       // if omitted: auto-generated from clip + topic
//     channels?: string[],        // default: top 3 for the clip's kind
//     staffId?: string,       // scope clip search to one clinician
//     kind?: 'photo'|'video'|'any' // clip search filter (default 'any')
//   }
//
// Flow:
//   1. searchClips(topic) OR fetchFusedRagContext(topic) → pick best-matching clip (top-1)
//   2. If no captionText: Claude-generate one from topic + clip context + practice framing
//   3. renderPhotoChannel / renderVideoChannel per channel
//   4. INSERT story_packages row (with rag_context when fusion ran)
//   5. Return full package
//
// Auth: Clerk JWT + workspace org-id + video_pipeline_enabled.
//
// Response 200:
//   {
//     packageId, topic, captionText, staffName,
//     clip: { assetId, similarity, kind, blobUrl, filename, ... },
//     renders: [{ channel, blobUrl, width, height, sizeBytes, hadSubtitles? }],
//     errors?: [{ channel, error }],
//     elapsedMs
//   }
// Errors: 400 / 401 / 403 / 404 / 409 (no matching clips) / 500

export const config = { runtime: 'nodejs', maxDuration: 300 }

import { waitUntil } from '@vercel/functions'
import { requireRole } from '../_lib/auth.js'
import { ALL_KNOWN_ROLES } from '../_lib/roles.js'
import { workspaceContext } from '../_lib/workspaceContext.js'
import { searchClips } from '../_lib/clipSearch.js'
import { fetchFusedRagContext } from '../_lib/ragFusion.js'
import { CHANNEL_SPECS } from '../_lib/brandRender.js'
import { VIDEO_CHANNEL_SPECS } from '../_lib/brandRenderVideo.js'
import { renderAndPatchPackage } from '../_lib/renderPackageChannels.js'
import { generateCaption } from '../_lib/captionGen.js'
import { generateSyntheticBroll, runwayConfigured } from '../_lib/syntheticBroll.js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY

const DEFAULT_PHOTO_CHANNELS = ['linkedin_feed', 'instagram_reel_still', 'blog_hero']
const DEFAULT_VIDEO_CHANNELS = ['linkedin_video', 'instagram_reel', 'blog_hero_video']

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
  const topic = String(body.topic || '').trim()
  if (!topic) return res.status(400).json({ error: 'topic_required' })
  if (topic.length > 2000) return res.status(400).json({ error: 'topic_too_long' })

  let captionText = String(body.captionText || '').trim().slice(0, 500)
  const staffId = body.staffId ? String(body.staffId) : null
  const requestedKind = body.kind && body.kind !== 'any' ? String(body.kind) : null
  // Phase 4 Tentpole PR B: optional campaign tagging.
  const campaignId = body.campaignId ? String(body.campaignId) : null

  // Resolve the campaign row up-front so caption gen + status check + insert
  // all see the same snapshot. Workspace-scoped lookup so a stale or
  // cross-tenant id can't be injected.
  let campaign = null
  if (campaignId) {
    const cRes = await sb(
      `campaigns?id=eq.${encodeURIComponent(campaignId)}&workspace_id=eq.${ws.id}` +
      `&select=id,name,status,theme_notes,content_style,cta_url,cta_label,cta_pitch&limit=1`
    )
    if (cRes.ok) {
      const rows = await cRes.json().catch(() => [])
      campaign = rows?.[0] || null
    }
    if (!campaign) {
      return res.status(404).json({ error: 'campaign_not_found' })
    }
    if (campaign.status !== 'active') {
      return res.status(409).json({ error: 'campaign_not_active', status: campaign.status })
    }
  }

  const started = Date.now()

  // --- 1. Clip search (V6: framing-aware when flag is on) ───────────────────
  let clips = []
  let ragContext = null

  if (ws.rag_fusion_enabled) {
    try {
      const fused = await fetchFusedRagContext({
        topic,
        workspaceId: ws.id,
        staffIds: staffId ? [staffId] : [],
        visualK: 1,
        visualKind: requestedKind,
        minVisualScore: 0.4,
      })
      clips = fused.visualChunks || []
      ragContext = {
        practice_chunks: (fused.practiceChunks || []).map((c) => ({
          chunk_id: c.source_id + ':' + (c.chunk_index ?? 0),
          score: c.similarity,
          text_preview: String(c.text || '').slice(0, 200),
          source_label: c.source_label,
        })),
        visual_chunks: clips.map((c) => ({
          chunk_id: c.chunkId,
          score: c.similarity,
          asset_id: c.assetId,
          kind: c.kind,
        })),
        query_expansion: fused.queryExpansion,
        fallback_reason: fused.fallbackReason,
        retrieved_at: new Date().toISOString(),
        timing: fused.timing,
      }
      // Store practice chunks on ragContext so caption generator can use them
      ragContext._practiceChunks = fused.practiceChunks || []
    } catch (e) {
      console.error('[generate-package] fetchFusedRagContext failed, falling back:', e.message)
      ragContext = { fallback_reason: 'embedding_error', retrieved_at: new Date().toISOString() }
    }
  }

  // Fallback: bare clip search when fusion is off or errored
  if (!clips.length) {
    try {
      clips = await searchClips({
        query: topic,
        workspaceId: ws.id,
        k: 1,
        kind: requestedKind,
        minScore: 0.4,
        staffId,
      })
    } catch (e) {
      console.error('[generate-package] clip search failed:', e.message)
      return res.status(500).json({ error: 'clip_search_failed', detail: e.message })
    }
  }

  if (!clips.length) {
    // V3 synthetic b-roll fallback — when no real clips match the topic, generate
    // footage via Runway Gen-3 Alpha Turbo instead of returning 409.
    // Requires RUNWAY_API_KEY to be configured. Without it, fall through to 409.
    if (!runwayConfigured()) {
      return res.status(409).json({
        error: 'no_matching_clips',
        message: 'No visually relevant clips found for this topic. Upload more media first.',
      })
    }

    // Determine channels ahead of time (video-only — Runway produces video).
    const brollChannels = (Array.isArray(body.channels) && body.channels.length)
      ? body.channels.map(String).filter((c) => VIDEO_CHANNEL_SPECS[c])
      : DEFAULT_VIDEO_CHANNELS

    if (!brollChannels.length) {
      return res.status(409).json({
        error: 'no_matching_clips',
        message: 'No visually relevant clips found and no valid video channels requested.',
      })
    }

    // Auto-generate caption now (will be used by the background render).
    if (!captionText) {
      try {
        captionText = await generateCaption({ topic, clip: {}, workspace: ws, staffId, practiceChunks: [], campaign })
      } catch {
        captionText = topic
      }
    }

    // Create package row immediately so the Slate card appears with a spinner.
    let brollPackageId
    try {
      const insRes = await sb('story_packages', {
        method: 'POST',
        body: JSON.stringify({
          workspace_id:  ws.id,
          staff_id:  staffId || null,
          source_asset_id: null,
          topic,
          caption_text:  captionText,
          similarity:    null,
          channels:      brollChannels,
          renders:       [],
          status:        'pending_broll',
          broll_status:  'generating',
          broll_model:   'gen3a_turbo',
          rag_context:   ragContext ? { ...ragContext, _practiceChunks: undefined } : null,
          campaign_id:   campaign?.id || null,
        }),
      })
      if (!insRes.ok) {
        const errText = await insRes.text().catch(() => '')
        console.error('[generate-package] broll package insert failed:', insRes.status, errText)
        return res.status(500).json({ error: 'db_insert_failed' })
      }
      const inserted = await insRes.json()
      brollPackageId = inserted?.[0]?.id
      if (!brollPackageId) return res.status(500).json({ error: 'insert_no_id' })
    } catch (e) {
      return res.status(500).json({ error: 'db_error', detail: e.message })
    }

    // Resolve clinician name for render overlays (best-effort).
    let brollStaffName = ''
    if (staffId) {
      const cRes = await sb(`staff?id=eq.${staffId}&workspace_id=eq.${ws.id}&select=name`)
      if (cRes.ok) {
        const cRows = await cRes.json()
        brollStaffName = cRows?.[0]?.name || ''
      }
    }

    // Fire-and-forget: generate → render → patch package. Runs within
    // the Vercel function's waitUntil budget (up to 300s). The Slate
    // polls packages with broll_status='generating' every few seconds.
    waitUntil(
      generateSyntheticBroll({
        packageId:     brollPackageId,
        topic,
        captionText,
        workspace:     ws,
        staffId:   staffId || null,
        channels:      brollChannels,
        staffName: brollStaffName,
      })
    )

    return res.status(202).json({
      packageId:    brollPackageId,
      topic,
      captionText,
      staffName: brollStaffName,
      status:       'pending_broll',
      broll_status: 'generating',
      broll_model:  'gen3a_turbo',
      channels:     brollChannels,
      renders:      [],
      elapsedMs:    Date.now() - started,
    })
  }

  const clip = clips[0]
  const isVideo = clip.kind === 'video'

  // Resolve channels
  const specMap = isVideo ? VIDEO_CHANNEL_SPECS : CHANNEL_SPECS
  const defaultChannels = isVideo ? DEFAULT_VIDEO_CHANNELS : DEFAULT_PHOTO_CHANNELS
  const channels = (Array.isArray(body.channels) && body.channels.length)
    ? body.channels.map(String).filter((c) => specMap[c])
    : defaultChannels

  if (!channels.length) {
    return res.status(400).json({ error: 'no_valid_channels' })
  }

  // --- 2. Look up clinician name ────────────────────────────────────────────
  let staffName = ''
  const lookupStaffId = clip.staffId || staffId
  if (lookupStaffId) {
    const cRes = await sb(`staff?id=eq.${lookupStaffId}&workspace_id=eq.${ws.id}&select=name`)
    if (cRes.ok) {
      const cRows = await cRes.json()
      staffName = cRows?.[0]?.name || ''
    }
  }

  // --- 3. Auto-generate caption if not provided ─────────────────────────────
  if (!captionText) {
    // Best-effort: pull the picked clip's own transcription so the caption is
    // anchored to what was actually said. The clip object from clip-search is
    // RPC-shaped and carries no transcript, so fetch it from the source asset
    // row here. Non-fatal — empty (photo / silent / missing) just leaves the
    // transcript grounding off, preserving prior behavior.
    let clipTranscript = ''
    if (clip.assetId) {
      try {
        const tRes = await sb(`media_assets?id=eq.${clip.assetId}&workspace_id=eq.${ws.id}&select=transcription&limit=1`)
        if (tRes.ok) {
          const tRows = await tRes.json()
          clipTranscript = tRows?.[0]?.transcription || ''
        }
      } catch { /* non-fatal — caption still grounds on phrases + practice memory */ }
    }
    try {
      captionText = await generateCaption({
        topic,
        clip,
        workspace: ws,
        staffId: lookupStaffId,
        practiceChunks: ragContext?._practiceChunks || [],
        campaign,
        clipTranscript,
      })
    } catch (e) {
      console.error('[generate-package] caption gen failed:', e.message)
      captionText = topic
    }
  }

  // --- 4. Create story_packages row (status=generating) ────────────────────
  let packageId
  try {
    const ragContextForDb = ragContext ? { ...ragContext } : null
    if (ragContextForDb) delete ragContextForDb._practiceChunks  // internal only

    const insertRes = await sb('story_packages', {
      method: 'POST',
      body: JSON.stringify({
        workspace_id: ws.id,
        staff_id: lookupStaffId || null,
        source_asset_id: clip.assetId || null,
        topic,
        caption_text: captionText,
        similarity: clip.similarity,
        channels,
        renders: [],
        status: 'generating',
        rag_context: ragContextForDb,
        campaign_id: campaign?.id || null,
      }),
    })
    if (!insertRes.ok) {
      const errText = await insertRes.text().catch(() => '')
      console.error('[generate-package] insert failed:', insertRes.status, errText)
      return res.status(500).json({ error: 'db_insert_failed' })
    }
    const inserted = await insertRes.json()
    packageId = inserted?.[0]?.id
    if (!packageId) return res.status(500).json({ error: 'insert_no_id' })
  } catch (e) {
    return res.status(500).json({ error: 'db_error', detail: e.message })
  }

  // --- 5. Render off the request path ──────────────────────────────────────
  // The row is already status='generating'. Render in the background instead of
  // awaiting it inside the request: a large source (downscaled on ingest) can
  // take minutes, which raced both the 300s function ceiling and the caller's
  // short-lived Clerk token (→ "invalid-token"). The Slate polls the row until
  // status flips to complete/failed. Mirrors the b-roll path's waitUntil + 202.
  waitUntil(
    renderAndPatchPackage({
      workspace:     ws,
      packageId,
      sourceUrl:     clip.blobUrl,
      sourceAssetId: clip.assetId,
      kind:          isVideo ? 'video' : 'photo',
      channels,
      captionText,
      staffName,
      filename:      clip.filename,
      topic,
      staffId:   lookupStaffId || null,
    })
  )

  return res.status(202).json({
    packageId,
    status: 'generating',
    topic,
    captionText,
    staffName,
    clip: {
      assetId:         clip.assetId,
      similarity:      clip.similarity,
      kind:            clip.kind,
      blobUrl:         clip.blobUrl,
      thumbnailUrl:    clip.thumbnailUrl,
      filename:        clip.filename,
      visualNarrative: clip.visualNarrative,
      aiTags:          clip.aiTags,
    },
    channels,
  })
}
