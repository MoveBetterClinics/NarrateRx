/**
 * api/_lib/syntheticBroll.js
 *
 * V3 — Synthetic b-roll generation via Runway Gen-3 Alpha Turbo.
 *
 * Flow (called from generate-package.js via waitUntil when no real clips found):
 *   1. generateBrollPrompt()   — Claude Haiku writes a cinematic text-to-video prompt
 *   2. submitRunwayJob()       — POST /v1/text_to_video → task ID
 *   3. pollRunwayTask()        — GET /v1/tasks/{id} every 5s, up to 180s
 *   4. uploadGeneratedVideo()  — download from Runway, upload to Vercel Blob as media_asset
 *   5. renderChannels()        — ffmpeg renders per channel (reuses renderVideoChannel)
 *   6. patchPackage()          — update story_packages: status=complete, renders, broll_*
 *
 * Error contract: this function does NOT throw. It catches all errors and patches
 * the package to broll_status='failed' so the Slate can surface it cleanly.
 * The generate-package endpoint returns 202 immediately — generation is fully async.
 *
 * Env required:
 *   RUNWAY_API_KEY         — Runway API key (key_…). Not set = generation skipped.
 *   SUPABASE_URL           — (inherited from platform)
 *   SUPABASE_SERVICE_KEY   — (inherited from platform)
 *   BLOB_READ_WRITE_TOKEN  — Vercel Blob write token
 */

import { generateText } from 'ai'
import { put as blobPut } from '@vercel/blob'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { createWriteStream, createReadStream } from 'node:fs'
import { stat, unlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { renderVideoChannel, VIDEO_CHANNEL_SPECS } from './brandRenderVideo.js'

const RUNWAY_API_BASE = 'https://api.runwayml.com/v1'
const RUNWAY_VERSION  = '2024-11-06'
const RUNWAY_MODEL    = 'gen3a_turbo'
const POLL_INTERVAL_MS = 5_000
const POLL_MAX_MS      = 180_000   // 3 min — Runway typically finishes in 30–90s

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY

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

// ── Prompt generation ─────────────────────────────────────────────────────────

/**
 * Ask Claude Haiku to write a cinematic text-to-video prompt for Runway.
 * The prompt describes b-roll footage (no talking heads, no text overlays)
 * that matches the topic and clinic specialty.
 */
async function generateBrollPrompt({ topic, workspace }) {
  const specialty = workspace.clinic_context
    ? workspace.clinic_context.slice(0, 300)
    : 'clinical healthcare practice'

  const { text } = await generateText({
    model: 'anthropic/claude-haiku-4-5',
    system: [
      'You write text-to-video prompts for Runway Gen-3.',
      'The footage is b-roll — no people speaking directly to camera, no text overlays, no title cards.',
      'Describe 5 seconds of cinematic, professionally-lit clinical footage.',
      'Focus on hands, equipment, environment, motion — things that visually represent the topic.',
      'Be specific about lighting (soft diffuse, warm clinical, natural window), camera angle, and movement.',
      'Keep it under 120 words. Do NOT include anything patient-facing or AI-generated faces.',
      'Output ONLY the prompt text — no preamble, no quotes, no explanation.',
    ].join(' '),
    messages: [{
      role: 'user',
      content: `Topic: ${topic}\nClinic context: ${specialty}\n\nWrite the b-roll prompt:`,
    }],
    maxOutputTokens: 180,
  })

  return text.trim()
}

// ── Runway API client ─────────────────────────────────────────────────────────

function runwayHeaders() {
  return {
    Authorization: `Bearer ${process.env.RUNWAY_API_KEY}`,
    'X-Runway-Version': RUNWAY_VERSION,
    'Content-Type': 'application/json',
  }
}

/**
 * Submit a text-to-video job to Runway Gen-3 Alpha Turbo.
 * Returns the Runway task ID.
 */
async function submitRunwayJob({ promptText, ratio = '1280:768', duration = 5 }) {
  const res = await fetch(`${RUNWAY_API_BASE}/text_to_video`, {
    method: 'POST',
    headers: runwayHeaders(),
    body: JSON.stringify({ model: RUNWAY_MODEL, promptText, ratio, duration }),
  })

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Runway submit failed ${res.status}: ${body.slice(0, 200)}`)
  }

  const data = await res.json()
  if (!data?.id) throw new Error('Runway did not return a task ID')
  return data.id
}

/**
 * Poll a Runway task until SUCCEEDED or FAILED, or until the timeout.
 * Returns the video URL string.
 */
async function pollRunwayTask(taskId) {
  const deadline = Date.now() + POLL_MAX_MS
  let consecutiveFailures = 0
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS))

    const res = await fetch(`${RUNWAY_API_BASE}/tasks/${encodeURIComponent(taskId)}`, {
      headers: runwayHeaders(),
    })
    if (!res.ok) {
      // Auth/permission failures never recover — bail immediately rather than
      // burning the full 3-minute poll window on a request that will keep 401ing.
      if (res.status === 401 || res.status === 403) {
        throw new Error(`Runway poll auth failed ${res.status} for task ${taskId}`)
      }
      // Transient errors (5xx, 429): tolerate a few, then give up so we surface
      // broll_status='failed' fast instead of timing out.
      consecutiveFailures += 1
      console.warn(`[syntheticBroll] poll ${taskId} status=${res.status} (failure ${consecutiveFailures})`)
      if (consecutiveFailures >= 5) {
        throw new Error(`Runway poll failed ${consecutiveFailures}x in a row (last status ${res.status})`)
      }
      continue
    }
    consecutiveFailures = 0

    const data = await res.json()
    if (data.status === 'SUCCEEDED') {
      const url = Array.isArray(data.output) ? data.output[0] : null
      if (!url) throw new Error('Runway SUCCEEDED but output was empty')
      return url
    }
    if (data.status === 'FAILED') {
      throw new Error(`Runway task failed: ${data.failure || '(no detail)'}`)
    }
    // PENDING / RUNNING — continue polling
  }
  throw new Error(`Runway task ${taskId} timed out after ${POLL_MAX_MS / 1000}s`)
}

// ── Blob + asset upload ───────────────────────────────────────────────────────

/**
 * Download the generated video from Runway and upload it to Vercel Blob.
 * Also inserts a media_asset row so the asset appears in the Media Library.
 * Returns { assetId, blobUrl }.
 */
async function uploadGeneratedVideo({ videoUrl, workspace, clinicianId, topic }) {
  // Stream download to a temp file to avoid buffering the whole MP4 in RAM.
  const tmpPath = join(tmpdir(), `runway-${randomUUID()}.mp4`)
  try {
    const r = await fetch(videoUrl)
    if (!r.ok) throw new Error(`Runway download failed: ${r.status}`)
    await pipeline(Readable.fromWeb(r.body), createWriteStream(tmpPath))

    // Read the file size via stat (cheap, metadata-only) rather than buffering
    // the whole MP4 into RAM with readFile — a >500MB clip would OOM the 1024MB
    // function. blobPut accepts a Node Readable, so we stream the temp file
    // straight to Blob; peak memory stays bounded by the stream buffer.
    const { size: sizeBytes } = await stat(tmpPath)
    const assetId = randomUUID()
    const pathname = `media/raw/${workspace.slug}/synthetic/${assetId}.mp4`

    const blob = await blobPut(pathname, createReadStream(tmpPath), {
      access: 'public',
      contentType: 'video/mp4',
      addRandomSuffix: false,
      allowOverwrite: false,
    })

    // Insert a media_asset row so producers can see + manage the generated clip.
    const insRes = await sb('media_assets', {
      method: 'POST',
      body: JSON.stringify({
        id: assetId,
        workspace_id: workspace.id,
        kind: 'video',
        status: 'complete',
        source: 'ai_generated',
        blob_url: blob.url,
        blob_pathname: pathname,
        mime_type: 'video/mp4',
        size_bytes: sizeBytes,
        filename: `synthetic-${topic.slice(0, 40).replace(/\s+/g, '-')}.mp4`,
        visual_narrative: `AI-generated b-roll for topic: ${topic}`,
        ai_tags: ['ai-generated', 'synthetic-broll'],
        clinician_id: clinicianId || null,
        notes: `Generated by Runway ${RUNWAY_MODEL} for topic: ${topic}`,
        created_by: 'system:synthetic-broll',
      }),
    })
    if (!insRes.ok) {
      console.warn('[syntheticBroll] media_asset insert failed:', insRes.status)
    }

    return { assetId, blobUrl: blob.url }
  } finally {
    unlink(tmpPath).catch(() => {})
  }
}

// ── Package patch helpers ─────────────────────────────────────────────────────

async function patchPackage(packageId, workspaceId, patch) {
  const r = await sb(
    `story_packages?id=eq.${encodeURIComponent(packageId)}&workspace_id=eq.${encodeURIComponent(workspaceId)}`,
    { method: 'PATCH', body: JSON.stringify(patch) }
  )
  if (!r.ok) {
    console.error('[syntheticBroll] patchPackage failed:', r.status)
  }
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * generateSyntheticBroll
 *
 * Called via waitUntil() from generate-package.js when no real clips exist.
 * Fully fire-and-forget — all errors are caught and surfaced as broll_status='failed'.
 *
 * @param {object} opts
 * @param {string} opts.packageId         — story_packages row to update on completion
 * @param {string} opts.topic             — interview topic (drives b-roll prompt)
 * @param {string} opts.captionText       — caption for video overlays
 * @param {object} opts.workspace         — full workspace row
 * @param {string|null} opts.clinicianId  — optional clinician for asset attribution
 * @param {string[]} opts.channels        — video channels to render (e.g. ['linkedin_video'])
 * @param {string} opts.clinicianName     — display name for caption overlays
 */
export async function generateSyntheticBroll({
  packageId,
  topic,
  captionText,
  workspace,
  clinicianId,
  channels,
  clinicianName,
}) {
  console.info(`[syntheticBroll] starting for package ${packageId}, topic="${topic}"`)

  try {
    // ── 1. Generate prompt ──────────────────────────────────────────────────
    const brollPrompt = await generateBrollPrompt({ topic, workspace })
    console.info(`[syntheticBroll] prompt: ${brollPrompt.slice(0, 100)}…`)

    await patchPackage(packageId, workspace.id, { broll_prompt: brollPrompt })

    // ── 2. Pick aspect ratio: portrait for vertical channels, landscape otherwise ──
    const verticalChannels = new Set(['instagram_reel', 'tiktok', 'youtube_short'])
    const hasVertical = channels.some((c) => verticalChannels.has(c))
    const ratio = hasVertical ? '768:1280' : '1280:768'

    // ── 3. Submit Runway job ────────────────────────────────────────────────
    const taskId = await submitRunwayJob({ promptText: brollPrompt, ratio, duration: 5 })
    console.info(`[syntheticBroll] Runway task ${taskId} submitted`)
    await patchPackage(packageId, workspace.id, { broll_task_id: taskId })

    // ── 4. Poll for completion ──────────────────────────────────────────────
    const videoUrl = await pollRunwayTask(taskId)
    console.info(`[syntheticBroll] Runway task ${taskId} succeeded`)

    // ── 5. Upload to Blob + create media_asset ──────────────────────────────
    const { assetId, blobUrl } = await uploadGeneratedVideo({
      videoUrl,
      workspace,
      clinicianId,
      topic,
    })
    console.info(`[syntheticBroll] asset ${assetId} uploaded to Blob`)

    // ── 6. Render channels ──────────────────────────────────────────────────
    const renders = []
    const errors  = []
    const safeSlug = `synthetic-${assetId.slice(0, 8)}`

    for (const channel of channels) {
      if (!VIDEO_CHANNEL_SPECS[channel]) {
        errors.push({ channel, error: 'unsupported_channel' })
        continue
      }
      try {
        const { buffer, width, height, hadSubtitles } = await renderVideoChannel({
          videoUrl: blobUrl,
          channel,
          captionText,
          workspace,
          clinicianName: clinicianName || '',
        })
        const pathname = `media/renders/${workspace.slug}/${assetId}/${channel}-${safeSlug}.mp4`
        const blob = await blobPut(pathname, buffer, {
          access: 'public', contentType: 'video/mp4', addRandomSuffix: false, allowOverwrite: true,
        })
        renders.push({ channel, blobUrl: blob.url, width, height, sizeBytes: buffer.length, hadSubtitles })
      } catch (e) {
        console.error(`[syntheticBroll] channel ${channel} render failed:`, e?.message)
        errors.push({ channel, error: e?.message || 'render_failed' })
      }
    }

    const finalStatus = renders.length > 0 ? 'complete' : 'failed'
    const errorMsg    = errors.length ? errors.map((e) => `${e.channel}: ${e.error}`).join('; ') : null

    // ── 7. Patch package to complete ────────────────────────────────────────
    await patchPackage(packageId, workspace.id, {
      status:           finalStatus,
      broll_status:     finalStatus === 'complete' ? 'complete' : 'failed',
      broll_model:      RUNWAY_MODEL,
      source_asset_id:  assetId,
      renders,
      error_message:    errorMsg,
    })

    console.info(`[syntheticBroll] package ${packageId} → ${finalStatus} (${renders.length} renders)`)

  } catch (err) {
    console.error('[syntheticBroll] fatal error for package', packageId, ':', err?.message || err)
    await patchPackage(packageId, workspace.id, {
      status:       'failed',
      broll_status: 'failed',
      error_message: `broll: ${err?.message || 'unknown error'}`,
    }).catch(() => {})
  }
}

/** True if the RUNWAY_API_KEY env var is configured (non-empty). */
export function runwayConfigured() {
  return Boolean(process.env.RUNWAY_API_KEY)
}
