// POST /api/voice-clone/create
//
// Accepts a raw audio binary body, uploads it to Vercel Blob, calls
// ElevenLabs Instant Voice Cloning, and persists the returned voice_id
// to the clinician row (plus consent timestamp + sample URL).
//
// Query params:
//   clinicianId — required; clinician whose voice this is
//   durationSec — recording length in seconds (server enforces 60s floor)
//   filename    — original file name for blob path + ext sniffing
//
// Response: { voiceId, sampleUrl }
//
// Idempotent on re-clone: if the clinician already has a live eleven_voice_id,
// the prior voice is deleted upstream first so we don't leak slots on the
// ElevenLabs tier (Starter caps at 10 custom voices).

export const config = {
  runtime: 'nodejs',
  maxDuration: 300,
  api: { bodyParser: false },
}

import { put as blobPut } from '@vercel/blob'
import { requireRole } from '../_lib/auth.js'
import { workspaceContext } from '../_lib/workspaceContext.js'
import { enforceLimit } from '../_lib/ratelimit.js'
import { createInstantVoice, deleteVoice } from '../_lib/elevenLabsVoiceClone.js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY

// 15MB cap — ElevenLabs IVC accepts files comfortably larger, but at typical
// conversational quality 15MB is ~10 min of audio, well over the 3–5 min
// IVC recommends. Larger uploads slow the round-trip without improving the
// clone, so we draw the line here.
const MAX_SAMPLE_BYTES = 15 * 1024 * 1024
// 60s floor — IVC works with shorter samples but quality drops sharply.
const MIN_SAMPLE_SECONDS = 60

function sb(path, init = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey:        SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      Prefer:        'return=representation',
      ...init.headers,
    },
  })
}

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

  const ws = await workspaceContext(req)
  if (!ws) return res.status(400).json({ error: 'Workspace not resolved' })

  const auth = await requireRole(req, null, { orgId: ws.clerk_org_id })
  if (!auth.ok) {
    return res.status(auth.reason === 'forbidden' ? 403 : 401).json({ error: auth.reason })
  }

  if (!(await enforceLimit(req, res, 'media'))) return

  const { searchParams } = new URL(req.url, 'http://localhost')
  const clinicianId = searchParams.get('clinicianId')
  const durationSec = parseInt(searchParams.get('durationSec') || '0', 10) || 0
  const rawFilename = searchParams.get('filename') || `voice-clone-${Date.now()}.webm`
  const contentType = req.headers['content-type'] || 'audio/webm'

  if (!clinicianId) return res.status(400).json({ error: 'clinicianId required' })
  if (durationSec && durationSec < MIN_SAMPLE_SECONDS) {
    return res.status(400).json({
      error: `Recording is too short — ${MIN_SAMPLE_SECONDS}s minimum for a usable voice clone.`,
    })
  }

  // ── Verify clinician belongs to this workspace + fetch name + existing clone ──
  const clinicianRes = await sb(
    `clinicians?id=eq.${encodeURIComponent(clinicianId)}` +
    `&workspace_id=eq.${ws.id}` +
    `&select=id,name,eleven_voice_id,voice_clone_revoked_at&limit=1`
  )
  if (!clinicianRes.ok) {
    return res.status(502).json({ error: 'Could not look up clinician' })
  }
  const [clinician] = await clinicianRes.json()
  if (!clinician) return res.status(404).json({ error: 'Clinician not found in this workspace' })

  // ── Buffer audio ────────────────────────────────────────────────────────────
  let audioBuffer
  try {
    audioBuffer = await readBody(req)
  } catch (e) {
    console.error(`[voice-clone] body read failed: ${e?.message}`)
    return res.status(400).json({ error: 'Could not read request body' })
  }
  if (audioBuffer.byteLength === 0) {
    return res.status(400).json({ error: 'Empty audio body' })
  }
  if (audioBuffer.byteLength > MAX_SAMPLE_BYTES) {
    const mb = Math.round(audioBuffer.byteLength / 1024 / 1024)
    return res.status(413).json({
      error: `Recording is ${mb}MB — the limit for voice cloning is 15MB. Trim or re-record at a lower bitrate.`,
    })
  }

  // ── Upload to Blob ──────────────────────────────────────────────────────────
  const safeName = rawFilename.replace(/[^a-z0-9._-]/gi, '_').slice(0, 80)
  const blobPath = `voice-clone-samples/${ws.slug}/${clinicianId}-${Date.now()}-${safeName}`
  let blobResult
  try {
    blobResult = await blobPut(blobPath, audioBuffer, {
      access: 'public',
      contentType,
      addRandomSuffix: false,
    })
  } catch (e) {
    console.error(`[voice-clone] blob upload failed ws=${ws.slug}: ${e?.message}`)
    return res.status(502).json({ error: 'Sample upload failed — please try again.' })
  }

  // ── Free the prior slot if any (best-effort) ──────────────────────────────
  if (clinician.eleven_voice_id && !clinician.voice_clone_revoked_at) {
    try {
      await deleteVoice(clinician.eleven_voice_id)
    } catch (e) {
      console.warn(`[voice-clone] prior voice delete failed for clinician=${clinicianId}: ${e?.message}`)
      // Continue — ElevenLabs will reject with max_voices_reached if so, and
      // we'll surface that below. Re-cloning a still-live voice isn't worth
      // blocking on a stale-state delete error.
    }
  }

  // ── Clone ────────────────────────────────────────────────────────────────
  let voiceId
  try {
    const result = await createInstantVoice({
      name:        `${clinician.name || 'Clinician'} — NarrateRx`,
      sampleUrl:   blobResult.url,
      description: `NarrateRx voice clone for ${clinician.name || clinicianId} (workspace ${ws.slug}).`,
    })
    voiceId = result.voiceId
  } catch (e) {
    const message = e?.message || String(e)
    console.error(`[voice-clone] createInstantVoice failed for clinician=${clinicianId}: ${message}`)
    // Map known upstream errors to friendlier messages.
    if (/missing_permissions/i.test(message) || /create_instant_voice_clone/i.test(message)) {
      return res.status(503).json({
        error: 'The ElevenLabs API key is missing the voice-cloning permission. An admin needs to enable "voices_write" on the key in the ElevenLabs dashboard, then redeploy.',
      })
    }
    if (/max_voices_reached/i.test(message)) {
      return res.status(409).json({
        error: 'Your ElevenLabs voice slot allowance is full. Revoke an existing clone (or upgrade your plan) and try again.',
      })
    }
    if (/voice_sample/i.test(message) || /audio/i.test(message)) {
      return res.status(422).json({
        error: 'ElevenLabs could not process the sample. Try a longer, cleaner recording (3–5 min, minimal background noise).',
      })
    }
    return res.status(502).json({ error: 'Voice cloning failed upstream.' })
  }

  // ── Persist ──────────────────────────────────────────────────────────────
  const patchRes = await sb(
    `clinicians?id=eq.${encodeURIComponent(clinicianId)}&workspace_id=eq.${ws.id}`,
    {
      method: 'PATCH',
      body: JSON.stringify({
        eleven_voice_id:        voiceId,
        voice_clone_consent_at: new Date().toISOString(),
        voice_clone_revoked_at: null,
        voice_clone_sample_url: blobResult.url,
      }),
    },
  )
  if (!patchRes.ok) {
    const body = await patchRes.text().catch(() => '')
    console.error(`[voice-clone] clinician PATCH ${patchRes.status}: ${body.slice(0, 300)}`)
    // The voice is created upstream but unpersisted — surface that so the
    // client can retry without re-uploading.
    return res.status(502).json({
      error: 'Voice created but could not save — please try again.',
      voiceIdUpstream: voiceId,
    })
  }

  return res.status(200).json({ voiceId, sampleUrl: blobResult.url })
}
