// POST /api/voice/pre-visit
//
// Generates a short personalised pre-appointment voice message in the
// clinician's cloned ElevenLabs voice, uploads the MP3 to Vercel Blob, and
// returns { url, script } to the caller.
//
// Pipeline:
//   1. Authenticate + workspace-scope the request
//   2. Look up the calling user's clinician row to get their voice clone ID
//   3. Call Claude (claude-haiku-4-5 via AI Gateway) to write a 3–5 sentence
//      warm pre-visit script
//   4. POST the script to ElevenLabs TTS (non-streaming — we need the full
//      buffer to upload to Blob)
//   5. PUT the MP3 buffer to Vercel Blob at voice/pre-visit/<uuid>.mp3
//   6. Return { url, script }
//
// Body: { patientName?: string, appointmentType: string, note?: string }
// Response: { url: string, script: string }
export const config = { runtime: 'nodejs', maxDuration: 60 }

import { randomUUID } from 'node:crypto'
import { generateText } from 'ai'
import { put } from '@vercel/blob'
import { workspaceContext } from '../_lib/workspaceContext.js'
import { requireRole } from '../_lib/auth.js'
import { enforceLimit } from '../_lib/ratelimit.js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY

// ElevenLabs defaults
const DEFAULT_VOICE_ID = 'pNInz6obpgDQGcFmaJgB'
const TTS_MODEL_ID = 'eleven_turbo_v2_5'
const MAX_SCRIPT_LENGTH = 800

function sb(path, init = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey:         SUPABASE_KEY,
      Authorization:  `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      Prefer:         'return=representation',
      ...init.headers,
    },
  })
}

const err = (res, msg, status = 400) => res.status(status).json({ error: msg })

export default async function handler(req, res) {
  if (req.method !== 'POST') return err(res, 'Method not allowed', 405)

  const ws = await workspaceContext(req)
  if (!ws) return err(res, 'Workspace not resolved', 400)

  const auth = await requireRole(req, null, { orgId: ws.clerk_org_id })
  if (!auth.ok) return res.status(auth.reason === 'forbidden' ? 403 : 401).json({ error: auth.reason })

  if (!(await enforceLimit(req, res, 'ai'))) return

  const { patientName, appointmentType, note } = req.body || {}

  if (!appointmentType || typeof appointmentType !== 'string' || !appointmentType.trim()) {
    return err(res, 'appointmentType is required')
  }

  // ── 1. Look up the clinician voice clone ────────────────────────────────────
  let voiceId = process.env.TTS_DEFAULT_VOICE_ID || DEFAULT_VOICE_ID
  try {
    const clRes = await sb(
      `clinicians?workspace_id=eq.${ws.id}&user_id=eq.${auth.userId}` +
      `&select=id,eleven_voice_id&limit=1`,
    )
    if (clRes.ok) {
      const rows = await clRes.json()
      if (rows[0]?.eleven_voice_id) voiceId = rows[0].eleven_voice_id
    }
  } catch (e) {
    console.warn('[voice/pre-visit] clinician voice lookup failed:', e?.message)
  }

  // ── 2. Generate the script via Claude ───────────────────────────────────────
  const apiKey = process.env.AI_GATEWAY_API_KEY
  if (!apiKey) return err(res, 'AI_GATEWAY_API_KEY not configured', 503)

  const systemPrompt = [
    "You are writing a short, warm pre-appointment voice message for a chiropractor named Dr. Q to send to a patient.",
    "Write in first-person as Dr. Q. Tone: warm, professional, direct.",
    "Length: 3–5 sentences. Do NOT add a greeting line like 'Hello' — start with the content.",
    "Do not add stage directions, quotes, or any formatting. Plain prose only.",
  ].join(' ')

  const namePhrase = patientName?.trim() ? patientName.trim() : 'a patient'
  const notePhrase = note?.trim() ? note.trim() : 'none'

  const userMessage = `Patient: ${namePhrase}. Appointment: ${appointmentType.trim()}. Extra note: ${notePhrase}.`

  let script
  try {
    const result = await generateText({
      model: 'anthropic/claude-haiku-4-5',
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }],
      maxTokens: 256,
    })
    script = (result.text || '').trim().slice(0, MAX_SCRIPT_LENGTH)
  } catch (e) {
    console.error('[voice/pre-visit] Claude call failed:', e?.message)
    return err(res, 'Script generation failed — try again', 502)
  }

  if (!script) return err(res, 'Model returned empty script', 500)

  // ── 3. Synthesise with ElevenLabs ───────────────────────────────────────────
  const elevenKey = process.env.ELEVENLABS_API_KEY
  if (!elevenKey) return err(res, 'ElevenLabs not configured', 503)

  const ttsUrl = `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}` +
    `?output_format=mp3_44100_128`

  let audioBuffer
  try {
    const ttsRes = await fetch(ttsUrl, {
      method: 'POST',
      headers: {
        'xi-api-key':   elevenKey,
        'content-type': 'application/json',
        accept:         'audio/mpeg',
      },
      body: JSON.stringify({
        text: script,
        model_id: TTS_MODEL_ID,
        voice_settings: { stability: 0.5, similarity_boost: 0.85 },
      }),
    })
    if (!ttsRes.ok) {
      const detail = await ttsRes.text().catch(() => '')
      console.error('[voice/pre-visit] ElevenLabs error', ttsRes.status, detail.slice(0, 500))
      return err(res, 'TTS synthesis failed', 502)
    }
    const arrayBuf = await ttsRes.arrayBuffer()
    audioBuffer = Buffer.from(arrayBuf)
  } catch (e) {
    console.error('[voice/pre-visit] ElevenLabs fetch failed:', e?.message)
    return err(res, 'TTS upstream unreachable', 502)
  }

  // ── 4. Upload to Vercel Blob ─────────────────────────────────────────────────
  const uuid = randomUUID()
  let blobUrl
  try {
    const blob = await put(`voice/pre-visit/${uuid}.mp3`, audioBuffer, {
      access: 'public',
      contentType: 'audio/mpeg',
    })
    blobUrl = blob.url
  } catch (e) {
    console.error('[voice/pre-visit] Blob upload failed:', e?.message)
    return err(res, 'Audio upload failed', 502)
  }

  return res.status(200).json({ url: blobUrl, script })
}
