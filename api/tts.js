// POST /api/tts
//
// Proxies a short text string to ElevenLabs and streams MP3 audio back to the
// browser. Used by InterviewSession to replace the browser's robotic
// speechSynthesis with a neural voice for the interviewer.
//
// Request body: { text: string, voiceId?: string, staffId?: string }
// Response: audio/mpeg stream
//
// Voice resolution order (Phase 5 Feature 3):
//   1. staffId → live (non-revoked) clone on clinicians.eleven_voice_id
//   2. explicit voiceId param
//   3. TTS_DEFAULT_VOICE_ID env
//   4. DEFAULT_VOICE_ID constant (Adam — Bernard's voice)
//
// Falls back gracefully — if ELEVENLABS_API_KEY is missing or the upstream
// call fails, returns a non-2xx and the client falls back to speechSynthesis.

export const config = { runtime: 'nodejs', maxDuration: 60 }

import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { enforceLimit } from './_lib/ratelimit.js'
import { requireRole } from './_lib/auth.js'
import { workspaceContext } from './_lib/workspaceContext.js'

// "Adam" — calm, warm male voice from the ElevenLabs default library. Used as
// Bernard's voice when no per-workspace override is set. Override per-deploy
// with the TTS_DEFAULT_VOICE_ID env var.
const DEFAULT_VOICE_ID = 'pNInz6obpgDQGcFmaJgB'

// eleven_flash_v2_5 — sub-400ms first-byte, good enough quality for
// conversational TTS. Use eleven_turbo_v2_5 for slightly better quality at
// slightly higher latency if needed later.
const DEFAULT_MODEL_ID = 'eleven_flash_v2_5'

const MAX_TEXT_LENGTH = 1200

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const ws = await workspaceContext(req)
  if (!ws) return res.status(400).json({ error: 'No workspace resolved for this request' })
  const auth = await requireRole(req, null, { orgId: ws.clerk_org_id })
  if (!auth.ok) return res.status(auth.reason === 'forbidden' ? 403 : 401).json({ error: auth.reason })

  if (!(await enforceLimit(req, res, 'ai'))) return

  const apiKey = process.env.ELEVENLABS_API_KEY
  if (!apiKey) return res.status(503).json({ error: 'TTS not configured' })

  const { text, voiceId, staffId, speed: bodySpeed } = req.body || {}
  if (!text || typeof text !== 'string') return res.status(400).json({ error: 'Missing text' })
  const trimmed = text.trim().slice(0, MAX_TEXT_LENGTH)
  if (!trimmed) return res.status(400).json({ error: 'Empty text' })

  // Phase 5 Feature 3 — if caller identifies a clinician AND that clinician
  // has a live voice clone, use the clone. Caller's explicit voiceId is the
  // next fallback, then env, then the Adam default.
  let cloneVoiceId = null
  if (staffId) {
    try {
      const r = await fetch(
        `${process.env.SUPABASE_URL}/rest/v1/clinicians` +
        `?id=eq.${encodeURIComponent(staffId)}` +
        `&workspace_id=eq.${ws.id}` +
        `&voice_clone_revoked_at=is.null` +
        `&eleven_voice_id=not.is.null` +
        `&select=eleven_voice_id&limit=1`,
        {
          headers: {
            apikey:        process.env.SUPABASE_SERVICE_KEY,
            Authorization: `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
          },
        },
      )
      if (r.ok) {
        const rows = await r.json()
        if (rows[0]?.eleven_voice_id) cloneVoiceId = rows[0].eleven_voice_id
      } else {
        console.error(`[tts] clinician voice lookup ${r.status} clinician=${staffId}`)
      }
    } catch (e) {
      console.error('[tts] clinician voice lookup threw:', e?.message || e)
    }
  }

  const voice = cloneVoiceId || voiceId || process.env.TTS_DEFAULT_VOICE_ID || DEFAULT_VOICE_ID
  const model = process.env.TTS_DEFAULT_MODEL_ID || DEFAULT_MODEL_ID

  // Playback speed — ElevenLabs accepts 0.7 (slower) … 1.2 (faster), default 1.0.
  // Tune globally via TTS_DEFAULT_SPEED env var; per-request override via body.
  // Clamp aggressively — upstream 422s on out-of-range values.
  const rawSpeed = Number(bodySpeed ?? process.env.TTS_DEFAULT_SPEED ?? 1.0)
  const speed = Number.isFinite(rawSpeed) ? Math.min(1.2, Math.max(0.7, rawSpeed)) : 1.0

  const url = `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voice)}/stream?output_format=mp3_44100_128`

  let upstream
  try {
    upstream = await fetch(url, {
      method: 'POST',
      headers: {
        'xi-api-key': apiKey,
        'content-type': 'application/json',
        accept: 'audio/mpeg',
      },
      body: JSON.stringify({
        text: trimmed,
        model_id: model,
        voice_settings: { stability: 0.4, similarity_boost: 0.75, style: 0.0, use_speaker_boost: true, speed },
      }),
    })
  } catch (e) {
    console.error('[tts] upstream fetch failed:', e?.message || e)
    return res.status(502).json({ error: 'TTS upstream unreachable' })
  }

  if (!upstream.ok || !upstream.body) {
    const detail = await upstream.text().catch(() => '')
    console.error('[tts] upstream error', upstream.status, detail.slice(0, 500))
    return res.status(502).json({ error: 'TTS upstream error', status: upstream.status })
  }

  res.setHeader('Content-Type', 'audio/mpeg')
  res.setHeader('Cache-Control', 'private, no-store')

  try {
    await pipeline(Readable.fromWeb(upstream.body), res)
  } catch (e) {
    // Client disconnected mid-stream, or upstream cut off — both are non-fatal.
    if (!res.writableEnded) {
      try { res.end() } catch { /* ignore */ }
    }
    console.warn('[tts] stream pipeline ended:', e?.message || e)
  }
}
