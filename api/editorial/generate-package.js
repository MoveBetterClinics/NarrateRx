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
//     clinicianId?: string,       // scope clip search to one clinician
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
//     packageId, topic, captionText, clinicianName,
//     clip: { assetId, similarity, kind, blobUrl, filename, ... },
//     renders: [{ channel, blobUrl, width, height, sizeBytes, hadSubtitles? }],
//     errors?: [{ channel, error }],
//     elapsedMs
//   }
// Errors: 400 / 401 / 403 / 404 / 409 (no matching clips) / 500

export const config = { runtime: 'nodejs', maxDuration: 300 }

import { generateText } from 'ai'
import { put as blobPut } from '@vercel/blob'
import { waitUntil } from '@vercel/functions'
import { requireRole } from '../_lib/auth.js'
import { ALL_KNOWN_ROLES } from '../_lib/roles.js'
import { workspaceContext } from '../_lib/workspaceContext.js'
import { searchClips } from '../_lib/clipSearch.js'
import { fetchFusedRagContext } from '../_lib/ragFusion.js'
import { renderPhotoChannel, CHANNEL_SPECS } from '../_lib/brandRender.js'
import { renderVideoChannel, VIDEO_CHANNEL_SPECS } from '../_lib/brandRenderVideo.js'
import { scoreCaptionFidelity } from '../_lib/captionFidelity.js'
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

/**
 * Generate a compelling 1-2 sentence caption.
 * V6: when practiceChunks are available, injects the clinician's prior
 * framing so the caption echoes their actual voice on this topic.
 * Phase 4 Tentpole PR B: when campaign is provided, injects the campaign's
 * theme + content_style so the caption serves the campaign goal.
 */
async function generateCaption({ topic, clip, workspace, practiceChunks = [], campaign = null }) {
  const toneHint = workspace?.brand_voice?.tone_descriptors?.join(', ') || 'warm, expert'
  const clipContext = [
    clip.visualNarrative ? `Visual: ${clip.visualNarrative}` : '',
    clip.aiTags?.length ? `Tags: ${(clip.aiTags || []).join(', ')}` : '',
  ].filter(Boolean).join('. ')

  const priorThinking = practiceChunks
    .slice(0, 3)
    .map((c) => String(c.text || '').slice(0, 200).trim())
    .filter(Boolean)
    .join(' … ')

  const systemLines = [
    'You write short, compelling social media captions for a clinical practitioner.',
    `Tone: ${toneHint}. Write 1-2 sentences only. Do NOT use hashtags. Do NOT include a call to action.`,
    'Speak from the practitioner\'s perspective as if they\'re sharing something meaningful.',
  ]
  if (priorThinking) {
    systemLines.push(`The practitioner's prior thinking on this topic: ${priorThinking}`)
    systemLines.push('Echo their specific clinical framing naturally — don\'t copy phrases verbatim.')
  }
  // Campaign context — tightens the caption to the campaign goal. The
  // content_style flag changes the register:
  //   • promotional  — pitch-y, urgency, drives toward event
  //   • relationship — warm, community, NO clinical talk
  //   • clinical     — default (no extra instruction)
  if (campaign) {
    if (campaign.theme_notes) {
      systemLines.push(`This caption is part of an active campaign: ${campaign.name}. Campaign theme: ${campaign.theme_notes}`)
    } else if (campaign.name) {
      systemLines.push(`This caption is part of an active campaign: ${campaign.name}.`)
    }
    if (campaign.content_style === 'promotional') {
      systemLines.push('Style: promotional. Subtly orient the reader toward an upcoming event — don\'t hard-sell, but make it clear something specific is happening.')
    } else if (campaign.content_style === 'relationship') {
      systemLines.push('Style: relationship — warm, community-focused. Do NOT talk about clinical care, assessments, or treatment. Focus on the people, the relationship, the moment.')
    }
  }

  const { text } = await generateText({
    model: 'anthropic/claude-haiku-4-5',
    system: systemLines.join('\n'),
    messages: [{
      role: 'user',
      content: `Topic: ${topic}
Clip context: ${clipContext || '(clinical care photo/video)'}

Write a caption (1-2 sentences, no hashtags, no CTA):`,
    }],
    maxOutputTokens: 100,
  })

  return text.trim().replace(/^["']|["']$/g, '')
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
  const clinicianId = body.clinicianId ? String(body.clinicianId) : null
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
        clinicianIds: clinicianId ? [clinicianId] : [],
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
        clinicianId,
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
        captionText = await generateCaption({ topic, clip: {}, workspace: ws, practiceChunks: [], campaign })
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
          clinician_id:  clinicianId || null,
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
    let brollClinicianName = ''
    if (clinicianId) {
      const cRes = await sb(`clinicians?id=eq.${clinicianId}&workspace_id=eq.${ws.id}&select=name`)
      if (cRes.ok) {
        const cRows = await cRes.json()
        brollClinicianName = cRows?.[0]?.name || ''
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
        clinicianId:   clinicianId || null,
        channels:      brollChannels,
        clinicianName: brollClinicianName,
      })
    )

    return res.status(202).json({
      packageId:    brollPackageId,
      topic,
      captionText,
      clinicianName: brollClinicianName,
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
  const isPhoto = clip.kind === 'photo'

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
  let clinicianName = ''
  const lookupClinicianId = clip.clinicianId || clinicianId
  if (lookupClinicianId) {
    const cRes = await sb(`clinicians?id=eq.${lookupClinicianId}&workspace_id=eq.${ws.id}&select=name`)
    if (cRes.ok) {
      const cRows = await cRes.json()
      clinicianName = cRows?.[0]?.name || ''
    }
  }

  // --- 3. Auto-generate caption if not provided ─────────────────────────────
  if (!captionText) {
    try {
      captionText = await generateCaption({
        topic,
        clip,
        workspace: ws,
        practiceChunks: ragContext?._practiceChunks || [],
        campaign,
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
        clinician_id: lookupClinicianId || null,
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

  // --- 5. Render each channel ───────────────────────────────────────────────
  const renders = []
  const errors = []

  for (const channel of channels) {
    try {
      const safeFilename = (clip.filename || 'render')
        .replace(/[^\w.-]/g, '_')
        .replace(/\.\w+$/, '')

      if (isPhoto) {
        const { buffer, width, height } = await renderPhotoChannel({
          photoUrl: clip.blobUrl,
          channel,
          captionText,
          workspace: ws,
          clinicianName,
        })
        const pathname = `media/renders/${ws.slug}/${clip.assetId}/${channel}-${safeFilename}.jpg`
        const blob = await blobPut(pathname, buffer, {
          access: 'public', contentType: 'image/jpeg', addRandomSuffix: false, allowOverwrite: true,
        })
        renders.push({ channel, blobUrl: blob.url, width, height, sizeBytes: buffer.length })

      } else if (isVideo) {
        const { buffer, width, height, hadSubtitles } = await renderVideoChannel({
          videoUrl: clip.blobUrl,
          channel,
          captionText,
          workspace: ws,
          clinicianName,
        })
        const pathname = `media/renders/${ws.slug}/${clip.assetId}/${channel}-${safeFilename}.mp4`
        const blob = await blobPut(pathname, buffer, {
          access: 'public', contentType: 'video/mp4', addRandomSuffix: false, allowOverwrite: true,
        })
        renders.push({ channel, blobUrl: blob.url, width, height, sizeBytes: buffer.length, hadSubtitles })

      } else {
        errors.push({ channel, error: `unsupported_kind: ${clip.kind}` })
      }
    } catch (e) {
      console.error(`[generate-package] channel ${channel} failed:`, e?.stack || e?.message || e)
      errors.push({ channel, error: e?.message || 'unknown' })
    }
  }

  // --- 6. Update package row with results ──────────────────────────────────
  const finalStatus = renders.length > 0 ? 'complete' : 'failed'
  const errorMessage = errors.length ? errors.map((e) => `${e.channel}: ${e.error}`).join('; ') : null

  await sb(`story_packages?id=eq.${packageId}&workspace_id=eq.${ws.id}`, {
    method: 'PATCH',
    body: JSON.stringify({
      renders,
      status: finalStatus,
      error_message: errorMessage,
    }),
  }).catch((e) => {
    console.error('[generate-package] patch failed:', e.message)
  })

  // Background voice-fidelity scoring — fire-and-forget via waitUntil.
  if (finalStatus === 'complete') {
    waitUntil(
      scoreCaptionFidelity({
        packageId,
        workspaceId:   ws.id,
        workspaceName: ws.display_name,
        clinicianId:   lookupClinicianId || null,
        topic,
        captionText,
      }).catch((e) => {
        console.error('[generate-package] caption fidelity scoring failed:', e?.message || e)
      })
    )
  }

  const elapsedMs = Date.now() - started

  return res.status(renders.length > 0 ? 200 : 500).json({
    packageId,
    topic,
    captionText,
    clinicianName,
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
    renders,
    errors: errors.length ? errors : undefined,
    elapsedMs,
  })
}
