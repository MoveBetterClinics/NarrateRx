// ElevenLabs Instant Voice Cloning (IVC) wrappers.
//
// Used by /api/voice-clone/create and /api/voice-clone/revoke to manage
// per-clinician voice clones. Kept dependency-free (raw fetch + FormData)
// so the module loads in the Node runtime without pulling the ElevenLabs
// SDK into the bundle.
//
// Tier note: IVC is available on Starter ($5/mo) and up. Each plan has a
// custom-voice slot cap (Starter: 10, Creator: 30). On 400 from /voices/add
// the upstream message typically says "max_voices_reached" — surface that
// to the user so they know to remove an old voice or upgrade.

const ELEVENLABS_BASE = 'https://api.elevenlabs.io'

/**
 * Create an Instant Voice Clone by downloading a sample from a blob URL and
 * uploading it to ElevenLabs.
 *
 * @param {object} args
 * @param {string} args.name           — human label for the voice (≤100 chars)
 * @param {string} args.sampleUrl      — public Vercel blob URL of the training audio
 * @param {string=} args.description   — optional ≤500 chars description
 * @returns {Promise<{voiceId: string}>}
 */
export async function createInstantVoice({ name, sampleUrl, description }) {
  const apiKey = process.env.ELEVENLABS_API_KEY
  if (!apiKey) throw new Error('[elevenLabsVoiceClone] ELEVENLABS_API_KEY not set')
  if (!name) throw new Error('[elevenLabsVoiceClone] name required')
  if (!sampleUrl) throw new Error('[elevenLabsVoiceClone] sampleUrl required')

  // Pull the sample from blob storage into memory. IVC samples are typically
  // 3–5 MB at conversational quality — well under any function memory cap.
  const sampleRes = await fetch(sampleUrl)
  if (!sampleRes.ok) {
    throw new Error(`[elevenLabsVoiceClone] sample fetch ${sampleRes.status} ${sampleUrl}`)
  }
  const sampleBlob = await sampleRes.blob()

  const form = new FormData()
  form.append('name', String(name).slice(0, 100))
  if (description) form.append('description', String(description).slice(0, 500))
  // Filename is purely cosmetic in the ElevenLabs UI but must end in a known
  // audio extension or upstream rejects with "invalid file type."
  const filename = inferFilename(sampleUrl)
  form.append('files', sampleBlob, filename)

  const r = await fetch(`${ELEVENLABS_BASE}/v1/voices/add`, {
    method: 'POST',
    headers: { 'xi-api-key': apiKey },
    body: form,
  })
  if (!r.ok) {
    const body = await r.text().catch(() => '')
    throw new Error(`[elevenLabsVoiceClone] /voices/add ${r.status}: ${body.slice(0, 400)}`)
  }
  const data = await r.json()
  const voiceId = data?.voice_id
  if (!voiceId) {
    throw new Error(`[elevenLabsVoiceClone] /voices/add returned no voice_id: ${JSON.stringify(data).slice(0, 300)}`)
  }
  return { voiceId }
}

/**
 * Delete a voice from the ElevenLabs account. Used on revoke + on re-clone
 * (so we don't leak slots).
 */
export async function deleteVoice(voiceId) {
  const apiKey = process.env.ELEVENLABS_API_KEY
  if (!apiKey) throw new Error('[elevenLabsVoiceClone] ELEVENLABS_API_KEY not set')
  if (!voiceId) return { ok: true, note: 'no voiceId — nothing to delete' }

  const r = await fetch(`${ELEVENLABS_BASE}/v1/voices/${encodeURIComponent(voiceId)}`, {
    method: 'DELETE',
    headers: { 'xi-api-key': apiKey },
  })
  // 404 from the upstream — voice already gone — is fine; treat as success
  // so revoke is idempotent.
  if (!r.ok && r.status !== 404) {
    const body = await r.text().catch(() => '')
    throw new Error(`[elevenLabsVoiceClone] DELETE /voices/${voiceId} ${r.status}: ${body.slice(0, 300)}`)
  }
  return { ok: true }
}

function inferFilename(url) {
  try {
    const u = new URL(url)
    const last = u.pathname.split('/').pop() || 'sample.webm'
    if (/\.(mp3|m4a|wav|webm|ogg|aac|flac)$/i.test(last)) return last
    return `${last}.webm`
  } catch {
    return 'sample.webm'
  }
}
