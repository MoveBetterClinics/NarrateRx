// api/_lib/segmentDetect.js
//
// Multi-clip video v1 (Phase 1). Turns one long source video into MANY proposed
// short segments by:
//   1. Extracting audio from the source URL (ffmpeg, audio-only — the full
//      video never lands on /tmp; mirrors the downscale-on-ingest philosophy).
//   2. Chunking the audio if it exceeds Whisper's 24MB limit, transcribing each
//      chunk (offsetting timestamps), and merging into one timestamped cue list.
//   3. One LLM pass over the timestamped transcript proposing standalone moments
//      ({ start_sec, end_sec, hook, why_it_stands_alone }), each ≤60s, with
//      voice-faithful clinical framing from the workspace brand voice.
//   4. Clamping/validating and persisting the proposals as video_segments rows.
//
// Runs OFF the request path (waitUntil) — transcribing + the LLM pass take
// minutes for a long seminar. The source asset's segment_status column carries
// the lifecycle ('detecting' → 'ready' | 'failed') so the UI can poll.
//
// This function NEVER throws when called via detectSegmentsForAsset — any
// failure is captured onto media_assets.segment_status='failed' + segment_error
// so the Slate surfaces it cleanly. Safe in waitUntil: it talks to Supabase with
// the service key, so it needs no caller token.

import { spawn } from 'node:child_process'
import { unlink as unlinkP, stat as statP, readdir } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { generateObject } from 'ai'
import { z } from 'zod'
import ffmpegPath from 'ffmpeg-static'
import { transcribeToSegments } from './whisper.js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY

const MODEL = 'anthropic/claude-sonnet-4-6'

// Hard cap on a single clip's length (matches MAX_RENDER_SECONDS in
// brandRenderVideo.js — the render pipeline caps to 60s, so a longer proposal
// would be silently truncated at render time anyway).
const MAX_CLIP_SECONDS = 60
// A clip shorter than this isn't worth a standalone post.
const MIN_CLIP_SECONDS = 8
// Default ceiling on proposals per source (spec default: top 8) to avoid review
// fatigue. Callers can override.
const DEFAULT_MAX_SEGMENTS = 8
// Bound transcription cost + the 300s function budget: only the first
// MAX_DETECT_SECONDS of a source are transcribed. Anything past it is reported
// as a non-fatal note (no silent caps).
const MAX_DETECT_SECONDS = 90 * 60
// Whisper hard limit is 25MB; chunk when the extracted audio approaches it.
const CHUNK_BYTES = 20 * 1024 * 1024
// Audio chunk length when splitting (20min @ 16kHz mono 32k ≈ 4.8MB, well under
// the per-file Whisper limit).
const CHUNK_SECONDS = 20 * 60

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

/** Run ffmpeg, resolving on exit-0 and rejecting with the stderr tail otherwise. */
function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    const proc = spawn(ffmpegPath, args, { stdio: ['ignore', 'ignore', 'pipe'] })
    const chunks = []
    proc.stderr.on('data', (c) => {
      chunks.push(c)
      const total = chunks.reduce((s, x) => s + x.length, 0)
      if (total > 256 * 1024) chunks.shift()
    })
    proc.on('close', (code) => {
      if (code === 0) return resolve()
      const tail = Buffer.concat(chunks).toString('utf8').trim().split('\n').slice(-8).join('\n')
      reject(new Error(`ffmpeg exited ${code}:\n${tail}`))
    })
    proc.on('error', (err) => reject(new Error(`ffmpeg spawn failed: ${err.message}`)))
  })
}

const segmentSchema = z.object({
  start_sec: z.number().min(0),
  end_sec: z.number().min(1),
  hook: z.string().min(3).max(120),
  why_it_stands_alone: z.string().min(3).max(300),
  transcript_excerpt: z.string().max(800).default(''),
})
const detectorOutput = z.object({
  segments: z.array(segmentSchema).max(20).default([]),
})

function mmss(sec) {
  const s = Math.max(0, Math.round(sec))
  const m = Math.floor(s / 60)
  const r = s % 60
  return `${m}:${String(r).padStart(2, '0')}`
}

function buildSystemPrompt(ws, maxSegments) {
  const lines = [
    `You are a senior social media editor for ${ws.app_name || ws.display_name || 'a clinical practice'}${ws.location ? ` (${ws.location})` : ''}.`,
    '',
    'You are given the timestamped transcript of ONE long source recording (a seminar, talk, or recorded session). Your job is to identify the strongest STANDALONE moments worth cutting into short social clips — NOT to slice the whole thing into equal pieces.',
    '',
    'The hard part is SELECTION, not cutting. A good clip is a complete, coherent thought that lands on its own: a vivid teaching beat, a demonstrable principle, a counterintuitive insight, or a quotable line. Skip filler, throat-clearing, repetition, and anything that only makes sense with surrounding context.',
    '',
  ]
  if (ws.clinic_context) lines.push(`Practice context: ${ws.clinic_context}`, '')
  if (ws.audience_short) lines.push(`Audience: ${ws.audience_short}`, '')
  if (ws.brand_voice) lines.push('Brand voice:', String(ws.brand_voice), '')
  lines.push(
    'Rules:',
    `- Propose at most ${maxSegments} segments — only the genuinely strong ones. Fewer is fine; never pad.`,
    `- Each segment must be between ${MIN_CLIP_SECONDS} and ${MAX_CLIP_SECONDS} seconds long. If a great moment runs longer, tighten the window to the ${MAX_CLIP_SECONDS}s core.`,
    '- Choose start_sec / end_sec to align with the cue timestamps you are given, so clips begin and end on a complete sentence — never mid-sentence.',
    '- Educational framing, not testimonial. Never imply diagnostic or treatment guarantees ("cures", "fixes for good", "100%").',
    '- Clinical-but-accessible tone. No jargon, no hype.',
    '',
    'For each segment output:',
    '- start_sec / end_sec — clip boundaries in seconds (numbers).',
    '- hook — a short, scroll-stopping title for the clip, in the practice\'s brand voice (≤120 chars).',
    '- why_it_stands_alone — one sentence on why this moment works as a standalone clip.',
    '- transcript_excerpt — the verbatim spoken words inside the window (trimmed to ≤800 chars).',
  )
  return lines.join('\n')
}

function buildUserMessage(cues, durationSec) {
  const lines = [
    `Source duration covered: ${mmss(durationSec)}.`,
    '',
    'Timestamped transcript (each line: [start→end] spoken text):',
    '',
  ]
  for (const c of cues) {
    lines.push(`[${mmss(c.start)}→${mmss(c.end)}] ${c.text}`)
  }
  return lines.join('\n')
}

/**
 * Extract audio from a source URL to /tmp as 16kHz mono mp3, chunking if it
 * exceeds Whisper's per-file limit. Returns merged, timestamp-offset cues plus
 * the covered duration and a truncation note (or null).
 */
async function transcribeSource(videoUrl) {
  const id = randomUUID()
  const audioPath = `/tmp/seg-audio-${id}.mp3`
  const chunkPrefix = `seg-chunk-${id}-`
  const cleanup = [audioPath]

  try {
    // Audio-only extract straight from the URL (ffmpeg reads over HTTP range; the
    // full video never materializes on /tmp). Cap at MAX_DETECT_SECONDS.
    await runFfmpeg([
      '-t', String(MAX_DETECT_SECONDS),
      '-i', videoUrl,
      '-vn',
      '-acodec', 'libmp3lame',
      '-ar', '16000',
      '-ac', '1',
      '-b:a', '32k',
      '-y', audioPath,
    ])

    const { size } = await statP(audioPath)
    let cues = []

    if (size <= CHUNK_BYTES) {
      cues = await transcribeToSegments(audioPath)
    } else {
      // Split into time-based chunks (stream copy — no re-encode) and transcribe
      // each, offsetting timestamps by the chunk's position in the source.
      await runFfmpeg([
        '-i', audioPath,
        '-f', 'segment',
        '-segment_time', String(CHUNK_SECONDS),
        '-c', 'copy',
        '-y', `/tmp/${chunkPrefix}%03d.mp3`,
      ])
      const all = await readdir('/tmp')
      const chunkFiles = all
        .filter((f) => f.startsWith(chunkPrefix) && f.endsWith('.mp3'))
        .sort()
      for (const f of chunkFiles) cleanup.push(`/tmp/${f}`)

      for (let i = 0; i < chunkFiles.length; i++) {
        const offset = i * CHUNK_SECONDS
        const part = await transcribeToSegments(`/tmp/${chunkFiles[i]}`)
        for (const c of part) {
          cues.push({ start: c.start + offset, end: c.end + offset, text: c.text })
        }
      }
    }

    const durationSec = cues.length ? cues[cues.length - 1].end : 0
    return { cues, durationSec }
  } finally {
    for (const f of cleanup) await unlinkP(f).catch(() => {})
  }
}

/**
 * Clamp + validate the model's proposals into render-ready segment rows.
 * Drops invalid windows, enforces the length bounds, sorts by start, and caps
 * to maxSegments.
 */
function normalizeSegments(proposed, maxSegments, sourceDuration) {
  const out = []
  for (const s of proposed) {
    let start = Math.max(0, Number(s.start_sec) || 0)
    let end = Number(s.end_sec) || 0
    if (sourceDuration > 0) end = Math.min(end, sourceDuration)
    if (end <= start) continue
    // Enforce the hard clip cap; keep the start, trim the tail.
    if (end - start > MAX_CLIP_SECONDS) end = start + MAX_CLIP_SECONDS
    if (end - start < MIN_CLIP_SECONDS) continue
    out.push({
      start_sec: Math.round(start * 100) / 100,
      end_sec: Math.round(end * 100) / 100,
      hook: String(s.hook || '').trim().slice(0, 120),
      why_it_stands_alone: String(s.why_it_stands_alone || '').trim().slice(0, 300),
      transcript_excerpt: String(s.transcript_excerpt || '').trim().slice(0, 800),
    })
  }
  out.sort((a, b) => a.start_sec - b.start_sec)
  return out.slice(0, maxSegments)
}

/**
 * Full detection run for one source asset. Idempotent: clears prior 'proposed'
 * segments before inserting the new batch (kept/discarded/rendered survive).
 * Never throws — failures land on media_assets.segment_status='failed'.
 *
 * @param {Object} p
 * @param {Object} p.workspace   — workspace row (id, brand voice/context fields)
 * @param {Object} p.asset       — media_assets row (id, blob_url, staff_id, duration_s)
 * @param {number} [p.maxSegments]
 * @returns {Promise<{ status: string, count: number, note: string|null }>}
 */
export async function detectSegmentsForAsset({ workspace, asset, maxSegments = DEFAULT_MAX_SEGMENTS }) {
  const ws = workspace
  const where = `id=eq.${asset.id}&workspace_id=eq.${ws.id}`

  try {
    if (!process.env.AI_GATEWAY_API_KEY) {
      throw new Error('AI_GATEWAY_API_KEY is not set on this deployment')
    }

    const { cues, durationSec } = await transcribeSource(asset.blob_url)
    if (!cues.length) {
      throw new Error('No speech detected in the source (transcription was empty)')
    }

    const { object } = await generateObject({
      model: MODEL,
      schema: detectorOutput,
      system: buildSystemPrompt(ws, maxSegments),
      messages: [{ role: 'user', content: buildUserMessage(cues, durationSec) }],
      temperature: 0.4,
    })

    const segments = normalizeSegments(object.segments || [], maxSegments, durationSec)

    // Replace any prior proposals (re-run support); leave human-touched rows.
    await sb(`video_segments?source_asset_id=eq.${asset.id}&workspace_id=eq.${ws.id}&status=eq.proposed`, {
      method: 'DELETE',
    })

    if (segments.length) {
      const rows = segments.map((s, i) => ({
        workspace_id: ws.id,
        source_asset_id: asset.id,
        staff_id: asset.staff_id || null,
        start_sec: s.start_sec,
        end_sec: s.end_sec,
        hook: s.hook,
        why_it_stands_alone: s.why_it_stands_alone,
        transcript_excerpt: s.transcript_excerpt,
        order_index: i,
        status: 'proposed',
        detection_model: MODEL,
      }))
      const ins = await sb('video_segments', { method: 'POST', body: JSON.stringify(rows) })
      if (!ins.ok) {
        const text = await ins.text().catch(() => '')
        throw new Error(`video_segments insert failed: ${text.slice(0, 300)}`)
      }
    }

    // Non-fatal note: source was longer than we transcribed.
    const note = durationSec >= MAX_DETECT_SECONDS
      ? `Detected from the first ${Math.round(MAX_DETECT_SECONDS / 60)} min of a longer source.`
      : null

    await sb(`media_assets?${where}`, {
      method: 'PATCH',
      body: JSON.stringify({
        segment_status: 'ready',
        segment_error: note,
        segments_detected_at: new Date().toISOString(),
      }),
    })

    return { status: 'ready', count: segments.length, note }
  } catch (e) {
    console.error('[segmentDetect] detection failed:', e?.stack || e?.message || e)
    await sb(`media_assets?${where}`, {
      method: 'PATCH',
      body: JSON.stringify({
        segment_status: 'failed',
        segment_error: (e?.message || 'detection failed').slice(0, 500),
      }),
    }).catch(() => {})
    return { status: 'failed', count: 0, note: null }
  }
}
