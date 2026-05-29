// Thin wrapper around the OpenAI Whisper transcription endpoint.
//
// Accepts a local file path (absolute, in /tmp) and returns an SRT string.
// Throws on API errors, missing key, or if the file exceeds Whisper's 25MB limit.
//
// Callers: brandRenderVideo.js (via renderVideoChannel).
// Strategy for large videos: extract audio to MP3 first (20×+ size reduction) then
// pass the audio path here instead of the raw video path.

import { readFile, stat } from 'node:fs/promises'

const WHISPER_URL = 'https://api.openai.com/v1/audio/transcriptions'

// Whisper API hard limit is 25MB. Keep 1MB headroom.
const MAX_BYTES = 24 * 1024 * 1024

/**
 * Transcribe a local audio/video file to SRT-format captions using Whisper-1.
 *
 * @param {string} filePath — absolute path in /tmp (mp4, mp3, m4a, wav, etc.)
 * @returns {Promise<string>} SRT-formatted subtitle text
 * @throws if OPENAI_API_KEY is missing, file too large, or API call fails
 */
export async function transcribeToSrt(filePath) {
  const key = process.env.OPENAI_API_KEY
  if (!key) throw new Error('OPENAI_API_KEY not set')

  const { size } = await stat(filePath)
  if (size > MAX_BYTES) {
    throw new Error(`File too large for Whisper: ${Math.round(size / 1e6)}MB (max 24MB). Extract audio first.`)
  }

  const fileBuffer = await readFile(filePath)
  const fileName = filePath.split('/').pop() || 'audio.mp4'
  const mimeType = fileName.endsWith('.mp3') ? 'audio/mpeg'
    : fileName.endsWith('.m4a') ? 'audio/mp4'
    : fileName.endsWith('.wav') ? 'audio/wav'
    : 'video/mp4'

  const form = new FormData()
  form.append('file', new Blob([fileBuffer], { type: mimeType }), fileName)
  form.append('model', 'whisper-1')
  form.append('response_format', 'srt')

  const res = await fetch(WHISPER_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}` },
    body: form,
  })

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Whisper API ${res.status}: ${body.slice(0, 300)}`)
  }

  return await res.text()
}
