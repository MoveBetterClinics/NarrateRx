// POST /api/editorial/generate-package
//
// Phase 2 Day 8 of the 30-day video output build.
// End-to-end story package generator: clip search + auto-caption + render.
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
//   1. searchClips(topic) → pick best-matching clip (top-1)
//   2. If no captionText: Claude-generate one from topic + clip context
//   3. renderPhotoChannel / renderVideoChannel per channel
//   4. INSERT story_packages row
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
import { renderPhotoChannel, CHANNEL_SPECS } from '../_lib/brandRender.js'
import { renderVideoChannel, VIDEO_CHANNEL_SPECS } from '../_lib/brandRenderVideo.js'
import { scoreCaptionFidelity } from '../_lib/captionFidelity.js'

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

/** Generate a compelling 1-2 sentence caption using Claude. */
async function generateCaption({ topic, clip, workspace }) {
  const toneHint = workspace?.brand_voice?.tone_descriptors?.join(', ') || 'warm, expert'
  const clipContext = [
    clip.visualNarrative ? `Visual: ${clip.visualNarrative}` : '',
    clip.aiTags?.length ? `Tags: ${(clip.aiTags || []).join(', ')}` : '',
  ].filter(Boolean).join('. ')

  const { text } = await generateText({
    model: 'anthropic/claude-haiku-4-5',
    system: `You write short, compelling social media captions for a clinical practitioner.
Tone: ${toneHint}. Write 1-2 sentences only. Do NOT use hashtags. Do NOT include a call to action.
Speak from the practitioner's perspective as if they're sharing something meaningful.`,
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

  const started = Date.now()

  // --- 1. Search clips — pick the best match ────────────────────────────────
  let clips
  try {
    clips = await searchClips({
      query: topic,
      workspaceId: ws.id,
      k: 1,
      kind: requestedKind,
      minScore: 0.4,    // slightly lower threshold so we almost always find something
      clinicianId,
    })
  } catch (e) {
    console.error('[generate-package] clip search failed:', e.message)
    return res.status(500).json({ error: 'clip_search_failed', detail: e.message })
  }

  if (!clips.length) {
    return res.status(409).json({
      error: 'no_matching_clips',
      message: 'No visually relevant clips found for this topic. Upload more media first.',
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
    const cRes = await sb(`clinicians?id=eq.${lookupClinicianId}&select=name`)
    if (cRes.ok) {
      const cRows = await cRes.json()
      clinicianName = cRows?.[0]?.name || ''
    }
  }

  // --- 3. Auto-generate caption if not provided ─────────────────────────────
  if (!captionText) {
    try {
      captionText = await generateCaption({ topic, clip, workspace: ws })
    } catch (e) {
      console.error('[generate-package] caption gen failed:', e.message)
      captionText = topic  // fallback: use the topic itself as the caption
    }
  }

  // --- 4. Create story_packages row (status=generating) ────────────────────
  // This allows callers to poll GET /api/editorial/packages/:id while renders run.
  // For the synchronous flow below, we update to complete/failed at the end.
  let packageId
  try {
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

  await sb(`story_packages?id=eq.${packageId}`, {
    method: 'PATCH',
    body: JSON.stringify({
      renders,
      status: finalStatus,
      error_message: errorMessage,
    }),
  }).catch((e) => {
    console.error('[generate-package] patch failed:', e.message)
  })

  // Background voice-fidelity scoring once the package is complete.
  // Fire-and-forget via waitUntil so we don't add ~2-4s to the response.
  // The Slate UI re-fetches packages on focus and will surface the score
  // when present.
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
