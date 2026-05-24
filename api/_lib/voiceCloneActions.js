// Shared core for voice-clone create/resume endpoints.
//
// Both endpoints arrive at the same point: a sample audio file lives at a
// public Vercel Blob URL, and we need to (a) free the clinician's prior
// voice slot if any, (b) ask ElevenLabs to clone, (c) persist the new
// voice_id + consent timestamp + sample URL to the clinicians row.
//
// /api/voice-clone/create handles the upload (raw audio in body) then calls
// in here. /api/voice-clone/resume skips upload (reuses a previously
// uploaded URL from a failed earlier attempt) then calls in here. This file
// is the only place the ElevenLabs + persist logic lives.

import { createInstantVoice, deleteVoice } from './elevenLabsVoiceClone.js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY

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

/**
 * Map an ElevenLabs error message to a structured response.
 * Caller passes the result straight to res.status(...).json(...).
 */
export function mapCloneError(message) {
  const msg = String(message || '')
  if (/missing_permissions/i.test(msg) || /create_instant_voice_clone/i.test(msg)) {
    return {
      status: 503,
      body: { error: 'The ElevenLabs API key is missing the voice-cloning permission. An admin needs to enable "voices_write" on the key in the ElevenLabs dashboard, then redeploy.' },
    }
  }
  if (/max_voices_reached/i.test(msg)) {
    return {
      status: 409,
      body: { error: 'Your ElevenLabs voice slot allowance is full. Revoke an existing clone (or upgrade your plan) and try again.' },
    }
  }
  if (/voice_sample/i.test(msg) || /audio/i.test(msg)) {
    return {
      status: 422,
      body: { error: 'ElevenLabs could not process the sample. Try a longer, cleaner recording (3–5 min, minimal background noise).' },
    }
  }
  return { status: 502, body: { error: 'Voice cloning failed upstream.' } }
}

/**
 * Clone the sample at `sampleUrl` to ElevenLabs, free any prior slot, and
 * persist the result to the clinician row.
 *
 * @param {object} args
 * @param {{id: string, slug: string}} args.ws
 * @param {{id: string, name: string|null, eleven_voice_id: string|null, voice_clone_revoked_at: string|null}} args.clinician
 * @param {string} args.sampleUrl   — public Vercel Blob URL of the sample
 * @returns {Promise<
 *   | { ok: true, voiceId: string, sampleUrl: string }
 *   | { ok: false, status: number, body: { error: string, sampleUrl?: string, voiceIdUpstream?: string } }
 * >}
 */
export async function cloneFromSampleUrl({ ws, clinician, sampleUrl }) {
  if (!sampleUrl) {
    return { ok: false, status: 400, body: { error: 'sampleUrl required' } }
  }

  // Free the prior slot best-effort. ElevenLabs Starter caps custom voices
  // at 10 — leaking slots on re-clones blocks future training.
  if (clinician.eleven_voice_id && !clinician.voice_clone_revoked_at) {
    try {
      await deleteVoice(clinician.eleven_voice_id)
    } catch (e) {
      console.warn(`[voice-clone] prior voice delete failed for clinician=${clinician.id}: ${e?.message}`)
      // Continue — surface max_voices_reached from createInstantVoice if it
      // matters; otherwise the dangling voice can be cleaned up manually.
    }
  }

  let voiceId
  try {
    const result = await createInstantVoice({
      name:        `${clinician.name || 'Clinician'} — NarrateRx`,
      sampleUrl,
      description: `NarrateRx voice clone for ${clinician.name || clinician.id} (workspace ${ws.slug}).`,
    })
    voiceId = result.voiceId
  } catch (e) {
    const message = e?.message || String(e)
    console.error(`[voice-clone] createInstantVoice failed for clinician=${clinician.id}: ${message}`)
    const mapped = mapCloneError(message)
    // Include sampleUrl so the client can stash it for a resume attempt.
    return { ok: false, status: mapped.status, body: { ...mapped.body, sampleUrl } }
  }

  const patchRes = await sb(
    `clinicians?id=eq.${encodeURIComponent(clinician.id)}&workspace_id=eq.${ws.id}`,
    {
      method: 'PATCH',
      body: JSON.stringify({
        eleven_voice_id:        voiceId,
        voice_clone_consent_at: new Date().toISOString(),
        voice_clone_revoked_at: null,
        voice_clone_sample_url: sampleUrl,
      }),
    },
  )
  if (!patchRes.ok) {
    const body = await patchRes.text().catch(() => '')
    console.error(`[voice-clone] clinician PATCH ${patchRes.status}: ${body.slice(0, 300)}`)
    return {
      ok: false,
      status: 502,
      body: {
        error: 'Voice created but could not save — please try again.',
        voiceIdUpstream: voiceId,
        sampleUrl,
      },
    }
  }

  return { ok: true, voiceId, sampleUrl }
}
