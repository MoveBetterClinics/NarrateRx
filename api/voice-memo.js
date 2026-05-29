// POST /api/voice-memo
//
// Accepts a raw audio binary body (Content-Type: audio/*, etc.), uploads it
// to Vercel Blob, transcribes via OpenAI Whisper, then creates an interview
// row with capture_mode='voice_memo' so the existing synthesis pipeline
// (content generation → content_items) works unchanged.
//
// Query params (set by VoiceMemo.jsx on the fetch URL):
//   filename    — original file name, used for blob path + Whisper ext hint
//   durationSec — recording length in seconds; stored for analytics/UI
//
// Response: { clinicianId, interviewId }
//
// Requires OPENAI_API_KEY for Whisper. The handler returns a clear 500 if the
// key is missing so the error is obvious in Vercel logs.
//
// Runtime notes:
//   • Node runtime (not Edge) — @clerk/backend + node:* imports incompatible
//     with the Edge bundler.
//   • bodyParser disabled — the request body IS the audio file (raw binary),
//     not JSON. Vercel's default parser would corrupt binary if it tried to
//     parse it as text.
//   • maxDuration 300s — long recordings can take time to buffer + transcribe.
//   • Whisper 25MB cap — Whisper refuses files over 25MB. We reject before
//     sending and include a human-readable note on how to reduce size.

export const config = {
  runtime: 'nodejs',
  maxDuration: 300,
  api: { bodyParser: false },
}

import { put as blobPut } from '@vercel/blob'
import { createClerkClient } from '@clerk/backend'
import { requireRole } from './_lib/auth.js'
import { workspaceContext } from './_lib/workspaceContext.js'
import { enforceLimit } from './_lib/ratelimit.js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY
const OPENAI_KEY   = process.env.OPENAI_API_KEY

// 25 MB — OpenAI Whisper's hard limit per file.
const WHISPER_MAX_BYTES = 25 * 1024 * 1024

let _clerk = null
function clerkClient() {
  if (!_clerk) _clerk = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY })
  return _clerk
}

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

/** Buffer the full request body into a single Buffer. */
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  // ── Auth + workspace ──────────────────────────────────────────────────────
  const ws = await workspaceContext(req)
  if (!ws) return res.status(400).json({ error: 'Workspace not resolved' })

  const auth = await requireRole(req, null, { orgId: ws.clerk_org_id })
  if (!auth.ok) {
    return res.status(auth.reason === 'forbidden' ? 403 : 401).json({ error: auth.reason })
  }

  if (!(await enforceLimit(req, res, 'media'))) return

  // ── Parse query params (filename, durationSec) ────────────────────────────
  const { searchParams } = new URL(req.url, 'http://localhost')
  const rawFilename  = searchParams.get('filename')  || `voice-memo-${Date.now()}.webm`
  const durationSec  = parseInt(searchParams.get('durationSec') || '0', 10) || null
  const contentType  = req.headers['content-type'] || 'audio/webm'

  // ── 1. Buffer audio body ──────────────────────────────────────────────────
  // We buffer (rather than stream) so the same bytes go to Blob upload AND
  // to the Whisper FormData POST without a second round-trip to the blob URL.
  // The 25MB Whisper limit bounds the maximum buffer size.
  let audioBuffer
  try {
    audioBuffer = await readBody(req)
  } catch (e) {
    console.error(`[voice-memo] body read failed: ${e?.message}`)
    return res.status(400).json({ error: 'Could not read request body' })
  }

  if (audioBuffer.byteLength > WHISPER_MAX_BYTES) {
    const mb = Math.round(audioBuffer.byteLength / 1024 / 1024)
    return res.status(413).json({
      error: `Recording is ${mb}MB — the 25MB transcription limit is around 90 minutes at standard quality. Trim the recording or export at a lower bitrate (e.g. mono 16kbps) and try again.`,
    })
  }

  // ── 2. Upload to Vercel Blob ──────────────────────────────────────────────
  const safeName   = rawFilename.replace(/[^a-z0-9._-]/gi, '_').slice(0, 80)
  const blobPath   = `voice-memos/${ws.slug}/${Date.now()}-${safeName}`
  let blobResult
  try {
    blobResult = await blobPut(blobPath, audioBuffer, {
      access: 'public',
      contentType,
      addRandomSuffix: false,
    })
  } catch (e) {
    console.error(`[voice-memo] blob upload failed for ws=${ws.slug}: ${e?.message}`)
    return res.status(502).json({ error: 'Audio upload failed — please try again.' })
  }

  // ── 3. Transcribe via OpenAI Whisper ─────────────────────────────────────
  if (!OPENAI_KEY) {
    console.error('[voice-memo] OPENAI_API_KEY is not set — transcription unavailable')
    return res.status(500).json({ error: 'Transcription service is not configured on this deployment. Set OPENAI_API_KEY.' })
  }

  let transcript
  try {
    // Whisper requires a multipart/form-data POST with the audio file.
    // Use the file extension as a hint so Whisper picks the right decoder.
    const ext  = rawFilename.split('.').pop()?.toLowerCase() || 'webm'
    const form = new FormData()
    form.append('file', new Blob([audioBuffer], { type: contentType }), `audio.${ext}`)
    form.append('model', 'whisper-1')
    form.append('response_format', 'text')

    const wRes = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${OPENAI_KEY}` },
      body: form,
    })
    if (!wRes.ok) {
      const errTxt = await wRes.text().catch(() => '')
      throw new Error(`Whisper ${wRes.status}: ${errTxt.slice(0, 200)}`)
    }
    transcript = (await wRes.text()).trim()
    if (!transcript) throw new Error('Whisper returned an empty transcript')
  } catch (e) {
    console.error(`[voice-memo] transcription error for ws=${ws.slug}: ${e?.message}`)
    return res.status(502).json({ error: `Transcription failed: ${e?.message}` })
  }

  // ── 4. Find or create Self-clinician for this user ────────────────────────
  // A user who goes straight to Voice Memo without ever doing a chat interview
  // won't have a clinician row yet. We create one bound to their Clerk user_id
  // so the row is reused across future captures.
  const wsFilter = `workspace_id=eq.${ws.id}`
  let clinicianId
  let defaultTone = 'smart'

  const clinRes = await sb(
    `clinicians?${wsFilter}&user_id=eq.${encodeURIComponent(auth.userId)}&select=id,default_tone&limit=1`
  )
  if (clinRes.ok) {
    const rows = await clinRes.json()
    if (rows.length) {
      clinicianId = rows[0].id
      defaultTone = rows[0].default_tone || 'smart'
    }
  }

  if (!clinicianId) {
    // No clinician row yet — create one. Fetch the display name from Clerk so
    // the label isn't just "Me". The user can rename from their profile later.
    let name = 'Me'
    try {
      const user = await clerkClient().users.getUser(auth.userId)
      const full = [user.firstName, user.lastName].filter(Boolean).join(' ')
      name = full || user.username || user.primaryEmailAddress?.emailAddress?.split('@')[0] || 'Me'
    } catch (e) {
      console.warn(`[voice-memo] could not fetch Clerk user ${auth.userId}: ${e?.message}`)
    }

    const cRes = await sb('clinicians', {
      method: 'POST',
      body: JSON.stringify({
        workspace_id: ws.id,
        name,
        user_id: auth.userId,
        created_by_id: auth.userId,
      }),
    })
    if (!cRes.ok) {
      const body = await cRes.text().catch(() => '')
      console.error(`[voice-memo] clinician create failed ${cRes.status}: ${body.slice(0, 300)}`)
      return res.status(500).json({ error: 'Could not create clinician record' })
    }
    clinicianId = (await cRes.json())[0]?.id
  }

  if (!clinicianId) {
    return res.status(500).json({ error: 'Clinician ID could not be determined' })
  }

  // ── 5. Create interview row (capture_mode = 'voice_memo') ─────────────────
  // The transcript lands as a single user-role message. The capture review
  // page drives all content generation from this — same client-driven pipeline
  // as a regular chat interview, no server-side generation here.
  const date  = new Date().toLocaleDateString('en-CA') // YYYY-MM-DD
  const topic = `Voice memo — ${date}`

  const ivRes = await sb('interviews', {
    method: 'POST',
    body: JSON.stringify({
      workspace_id:              ws.id,
      clinician_id:              clinicianId,
      owner_id:                  auth.userId,
      topic,
      status:                    'in_progress',
      capture_mode:              'voice_memo',
      source_audio_url:          blobResult.url,
      source_audio_duration_sec: durationSec,
      messages:                  [{ role: 'user', content: transcript }],
      tone:                      defaultTone,
      voice_mode:                'personal',
      generation_style:          'blog_post',
    }),
  })
  if (!ivRes.ok) {
    const body = await ivRes.text().catch(() => '')
    console.error(`[voice-memo] interview create failed ${ivRes.status}: ${body.slice(0, 300)}`)
    return res.status(500).json({ error: 'Could not save interview record' })
  }
  const interview = (await ivRes.json())[0]
  if (!interview?.id) {
    return res.status(500).json({ error: 'Interview created but no ID returned' })
  }

  return res.status(200).json({ clinicianId, interviewId: interview.id })
}
