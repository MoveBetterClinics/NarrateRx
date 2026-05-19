// Neural TTS client. Fetches audio from /api/tts (ElevenLabs proxy) and plays
// it back via an Audio element. Falls back to window.speechSynthesis on error
// so the interview keeps working even if ElevenLabs is unreachable or the env
// var isn't configured.
//
// iOS Safari note: the Audio element must be "user-activated" before the
// first programmatic .play() works. MicCheck primes a silent <audio> inside
// the user's click handler so subsequent neural-TTS playback succeeds.
//
// Usage:
//   const tts = createTtsPlayer()
//   tts.speak('Hello there', { onStart, onEnd })
//   tts.cancel()

import { apiFetchResponse } from '@/lib/api'

/** @typedef {{ onStart?: () => void; onEnd?: () => void; onError?: (e: unknown) => void; voiceId?: string }} SpeakOptions */

function speakViaSynthesis(text, { onStart, onEnd, onError }) {
  if (typeof window === 'undefined' || !window.speechSynthesis) {
    onError?.(new Error('speechSynthesis unavailable'))
    onEnd?.()
    return
  }
  try {
    window.speechSynthesis.cancel()
    const utterance = new SpeechSynthesisUtterance(text)
    const voices = window.speechSynthesis.getVoices()
    const priority = [
      v => v.name === 'Google US English',
      v => v.name?.startsWith?.('Google') && v.lang?.startsWith?.('en'),
      v => v.name?.includes?.('Samantha') && v.localService,
      v => v.name?.includes?.('Enhanced') && v.lang?.startsWith?.('en'),
      v => v.lang === 'en-US' && v.localService,
      v => v.lang?.startsWith?.('en'),
    ]
    for (const test of priority) {
      const match = voices.find(test)
      if (match) { utterance.voice = match; break }
    }
    utterance.rate = 1.1
    utterance.pitch = 1.0
    utterance.onstart = () => onStart?.()
    utterance.onend = () => onEnd?.()
    utterance.onerror = (e) => { onError?.(e); onEnd?.() }
    onStart?.()
    window.speechSynthesis.speak(utterance)
  } catch (e) {
    onError?.(e)
    onEnd?.()
  }
}

export function createTtsPlayer() {
  /** @type {HTMLAudioElement | null} */
  let audio = null
  /** @type {AbortController | null} */
  let abort = null
  /** @type {string | null} */
  let blobUrl = null
  let usingSynthesis = false

  function teardownAudio() {
    if (audio) {
      audio.onended = null
      audio.onerror = null
      audio.onplaying = null
      try { audio.pause() } catch { /* ignore */ }
      audio.src = ''
      audio = null
    }
    if (blobUrl) {
      try { URL.revokeObjectURL(blobUrl) } catch { /* ignore */ }
      blobUrl = null
    }
  }

  /**
   * @param {string} text
   * @param {SpeakOptions} [opts]
   */
  async function speak(text, opts = {}) {
    cancel()
    if (!text || !text.trim()) { opts.onEnd?.(); return }

    abort = new AbortController()
    const signal = abort.signal

    let res
    try {
      res = await apiFetchResponse('/api/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, voiceId: opts.voiceId }),
        signal,
      })
    } catch {
      if (signal.aborted) return
      // Network/4xx/5xx → graceful fallback
      usingSynthesis = true
      speakViaSynthesis(text, opts)
      return
    }

    if (signal.aborted) return

    let blob
    try {
      blob = await res.blob()
    } catch {
      if (signal.aborted) return
      usingSynthesis = true
      speakViaSynthesis(text, opts)
      return
    }
    if (signal.aborted) return

    blobUrl = URL.createObjectURL(blob)
    audio = new Audio(blobUrl)
    audio.onplaying = () => opts.onStart?.()
    audio.onended = () => { opts.onEnd?.(); teardownAudio() }
    audio.onerror = () => {
      opts.onError?.(audio?.error || new Error('audio playback failed'))
      teardownAudio()
      // Last-resort fallback if MP3 fails to play (rare).
      usingSynthesis = true
      speakViaSynthesis(text, opts)
    }
    try {
      await audio.play()
    } catch {
      // iOS autoplay block, or element disposed mid-await.
      if (signal.aborted) return
      teardownAudio()
      usingSynthesis = true
      speakViaSynthesis(text, opts)
    }
  }

  function cancel() {
    if (abort) { try { abort.abort() } catch { /* ignore */ } abort = null }
    teardownAudio()
    if (usingSynthesis && typeof window !== 'undefined') {
      try { window.speechSynthesis?.cancel() } catch { /* ignore */ }
      usingSynthesis = false
    }
  }

  return { speak, cancel }
}

// A 100ms silent MP3 — used by MicCheck to gesture-prime <audio> playback on
// iOS Safari, the same way we prime speechSynthesis. Calling .play() on this
// inside a click handler makes subsequent programmatic Audio.play() calls
// succeed for the rest of the page lifetime.
export const SILENT_MP3 =
  'data:audio/mp3;base64,SUQzBAAAAAAAI1RTU0UAAAAPAAADTGF2ZjU4Ljc2LjEwMAAAAAAAAAAAAAAA//tQxAADB8AAAaQAAAgAAA0gAAABExBTUUzLjEwMFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVU='

export function primeAudioPlayback() {
  try {
    const a = new Audio(SILENT_MP3)
    a.volume = 0
    const p = a.play()
    if (p && typeof p.then === 'function') p.catch(() => { /* ignore */ })
  } catch { /* ignore */ }
}
