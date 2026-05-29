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

/**
 * Transcribe a local audio file to timestamped segments using Whisper-1's
 * verbose_json response. Each segment is a coherent cue (~5–15s) with start/end
 * in seconds — the raw material the multi-clip detector slices into standalone
 * moments. Callers that need only burned-in captions should use transcribeToSrt.
 *
 * @param {string} filePath — absolute path in /tmp (mp3 strongly preferred; the
 *   Whisper MP4 multipart bug means callers should extract audio first)
 * @returns {Promise<Array<{start: number, end: number, text: string}>>}
 * @throws if OPENAI_API_KEY is missing, file too large, or API call fails
 */
export async function transcribeToSegments(filePath) {
  const key = process.env.OPENAI_API_KEY
  if (!key) throw new Error('OPENAI_API_KEY not set')

  const { size } = await stat(filePath)
  if (size > MAX_BYTES) {
    throw new Error(`File too large for Whisper: ${Math.round(size / 1e6)}MB (max 24MB). Chunk first.`)
  }

  const fileBuffer = await readFile(filePath)
  const fileName = filePath.split('/').pop() || 'audio.mp3'
  const mimeType = fileName.endsWith('.mp3') ? 'audio/mpeg'
    : fileName.endsWith('.m4a') ? 'audio/mp4'
    : fileName.endsWith('.wav') ? 'audio/wav'
    : 'video/mp4'

  const form = new FormData()
  form.append('file', new Blob([fileBuffer], { type: mimeType }), fileName)
  form.append('model', 'whisper-1')
  form.append('response_format', 'verbose_json')
  // Only the segment timestamps are needed; word-level granularity would bloat
  // the response without improving clip-boundary selection.
  form.append('timestamp_granularities[]', 'segment')

  const res = await fetch(WHISPER_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}` },
    body: form,
  })

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Whisper API ${res.status}: ${body.slice(0, 300)}`)
  }

  const json = await res.json().catch(() => null)
  const segments = Array.isArray(json?.segments) ? json.segments : []
  return segments
    .map((s) => ({
      start: Number(s.start) || 0,
      end: Number(s.end) || 0,
      text: String(s.text || '').trim(),
    }))
    .filter((s) => s.text && s.end > s.start)
}
