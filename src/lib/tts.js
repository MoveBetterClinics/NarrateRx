// Neural TTS client. Fetches audio from /api/tts (ElevenLabs proxy) and plays
// it back via a long-lived <audio> element. Falls back to
// window.speechSynthesis on error so the interview keeps working even if
// ElevenLabs is unreachable or the env var isn't configured.
//
// iOS audio-unlock model:
//   iOS Safari (and iOS Chrome, both WebKit) only allows HTMLMediaElement.play()
//   to produce sound if the element has been "user-activated" — i.e. .play()
//   was called inside a user-gesture handler — AND the play() call happens
//   close enough to that gesture (or on a previously activated element).
//
//   Crucially, the activation is PER-ELEMENT: a fresh `new Audio()` is locked
//   even if some other element on the page is already unlocked. The audio
//   also "decays" out of gesture context: if you fetch a blob asynchronously
//   and then call .play() seconds later, you're outside the gesture window
//   and need a previously-activated element.
//
//   We solve both with ONE shared, module-level <audio> element. It's primed
//   inside the MicCheck click handler (which makes a silent .play() call →
//   unlocks the element). All later speak() calls reuse the same element by
//   swapping .src — no fresh `new Audio()`, so the unlock persists for the
//   entire page lifetime.
//
// Usage:
//   import { primeAudioPlayback, createTtsPlayer } from '@/lib/tts'
//   // inside a click handler somewhere early:
//   primeAudioPlayback()
//   // later:
//   const tts = createTtsPlayer()
//   tts.speak('Hello there', { onStart, onEnd })
//   tts.cancel()

import { apiFetchResponse } from '@/lib/api'

/** @typedef {{ onStart?: () => void; onEnd?: () => void; onError?: (e: unknown) => void; voiceId?: string }} SpeakOptions */

// A 100ms silent MP3 — used to gesture-prime <audio> playback on iOS WebKit.
export const SILENT_MP3 =
  'data:audio/mp3;base64,SUQzBAAAAAAAI1RTU0UAAAAPAAADTGF2ZjU4Ljc2LjEwMAAAAAAAAAAAAAAA//tQxAADB8AAAaQAAAgAAA0gAAABExBTUUzLjEwMFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVU='

// Module-level shared audio element. Created lazily; reused for every speak()
// call. Once primed inside a user gesture, it stays unlocked for the page
// lifetime — so subsequent async .play() calls (after fetching the next TTS
// blob) succeed even though they're well outside the gesture window.
/** @type {HTMLAudioElement | null} */
let sharedAudio = null
/** @type {string | null} */
let currentBlobUrl = null
let isPrimed = false

// Subscribers notified when the audio element fails persistently (route
// change, audio-session interruption from CarPlay/headphones/incoming call,
// etc.). UI can render a "Tap to restore audio" affordance to re-prime.
/** @type {Set<() => void>} */
const audioFailureSubscribers = new Set()

export function onAudioPlaybackFailure(handler) {
  audioFailureSubscribers.add(handler)
  return () => audioFailureSubscribers.delete(handler)
}

function notifyAudioFailure() {
  audioFailureSubscribers.forEach((h) => { try { h() } catch { /* ignore */ } })
}

function ensureSharedAudio() {
  if (typeof window === 'undefined') return null
  if (!sharedAudio) {
    sharedAudio = new Audio()
    sharedAudio.preload = 'auto'
  }
  return sharedAudio
}

/**
 * Tear down the shared audio element and reset priming. Call from inside a
 * user gesture (followed immediately by primeAudioPlayback) when the audio
 * session has been interrupted and the element is in a broken state — e.g.
 * iOS audio route changed under us and .play() now silently no-ops.
 */
export function resetAudioPlayback() {
  if (sharedAudio) {
    try { sharedAudio.pause() } catch { /* ignore */ }
    try { sharedAudio.src = '' } catch { /* ignore */ }
    sharedAudio = null
  }
  if (currentBlobUrl) {
    try { URL.revokeObjectURL(currentBlobUrl) } catch { /* ignore */ }
    currentBlobUrl = null
  }
  isPrimed = false
}

function clearBlobUrl() {
  if (currentBlobUrl) {
    try { URL.revokeObjectURL(currentBlobUrl) } catch { /* ignore */ }
    currentBlobUrl = null
  }
}

/**
 * Call this synchronously from inside a user-gesture handler (click, tap,
 * keydown). It plays a silent MP3 on the shared <audio> element, which
 * "user-activates" the element on iOS WebKit. All subsequent .play() calls
 * on the same element will then succeed even from async contexts (e.g. after
 * awaiting a fetch).
 */
export function primeAudioPlayback() {
  const a = ensureSharedAudio()
  if (!a) return
  // Already activated — re-priming would interrupt anything currently playing
  // (e.g. the speaker-test ElevenLabs sample). Idempotent no-op.
  if (isPrimed) return
  try {
    // Resetting src to a silent MP3 inside the gesture both activates the
    // element and gets it into a "playing" state we can interrupt cleanly.
    a.src = SILENT_MP3
    a.volume = 0
    a.muted = false
    const p = a.play()
    if (p && typeof p.then === 'function') {
      p.then(() => {
        // Once activated, restore volume so real TTS plays at full output.
        // Don't pause here — leaving the silent buffer playing for 100ms is
        // imperceptible and avoids racing the next .src assignment.
        a.volume = 1
        isPrimed = true
      }).catch(() => {
        // Activation failed (rare — usually means no gesture context). Leave
        // isPrimed=false; the next gesture call will try again.
      })
    } else {
      a.volume = 1
      isPrimed = true
    }
  } catch { /* ignore */ }
}

export function isAudioPrimed() {
  return isPrimed
}

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
  /** @type {AbortController | null} */
  let abort = null
  let usingSynthesis = false
  /** @type {((this: HTMLAudioElement, ev: Event) => unknown) | null} */
  let onEndHandler = null
  /** @type {((this: HTMLAudioElement, ev: Event) => unknown) | null} */
  let onPlayingHandler = null
  /** @type {((this: HTMLAudioElement, ev: Event) => unknown) | null} */
  let onErrorHandler = null

  function detachHandlers() {
    const a = sharedAudio
    if (!a) return
    if (onEndHandler) a.removeEventListener('ended', onEndHandler)
    if (onPlayingHandler) a.removeEventListener('playing', onPlayingHandler)
    if (onErrorHandler) a.removeEventListener('error', onErrorHandler)
    onEndHandler = null
    onPlayingHandler = null
    onErrorHandler = null
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

    const a = ensureSharedAudio()
    if (!a) {
      usingSynthesis = true
      speakViaSynthesis(text, opts)
      return
    }

    // Revoke the previous utterance's blob URL once we have the next one
    // ready, so we don't leak object URLs across the session.
    clearBlobUrl()
    currentBlobUrl = URL.createObjectURL(blob)

    onPlayingHandler = () => opts.onStart?.()
    onEndHandler = () => {
      detachHandlers()
      opts.onEnd?.()
    }
    onErrorHandler = () => {
      const err = a.error || new Error('audio playback failed')
      detachHandlers()
      // Audio session is likely interrupted (iOS route change, BT
      // disconnect, etc.). Tear down the element so the next user gesture
      // can re-prime a fresh one — the existing element often stays in a
      // broken state where .play() resolves silently.
      resetAudioPlayback()
      notifyAudioFailure()
      opts.onError?.(err)
      // Still try synthesis as a last-ditch — harmless on iOS (silent), but
      // works on desktop browsers where ElevenLabs may be the only fault.
      usingSynthesis = true
      speakViaSynthesis(text, opts)
    }
    a.addEventListener('playing', onPlayingHandler)
    a.addEventListener('ended', onEndHandler)
    a.addEventListener('error', onErrorHandler)

    a.src = currentBlobUrl
    a.volume = 1
    a.muted = false

    try {
      const p = a.play()
      if (p && typeof p.then === 'function') {
        await p
      }
    } catch {
      // iOS autoplay block (element never primed, or unlock decayed under
      // load), or element disposed mid-await. Fall through to synthesis,
      // but also notify subscribers so the UI can offer a "Tap to restore
      // audio" affordance — synthesis is silent on iOS in non-gesture
      // contexts, so a fallback alone isn't a real recovery.
      if (signal.aborted) return
      detachHandlers()
      resetAudioPlayback()
      notifyAudioFailure()
      usingSynthesis = true
      speakViaSynthesis(text, opts)
    }
  }

  function cancel() {
    if (abort) { try { abort.abort() } catch { /* ignore */ } abort = null }
    detachHandlers()
    if (sharedAudio) {
      try { sharedAudio.pause() } catch { /* ignore */ }
      // Do NOT clear sharedAudio.src — that can "deactivate" the element on
      // some iOS versions, forcing us to re-prime. Leave the previous blob
      // URL loaded; it'll be swapped on the next speak().
    }
    if (usingSynthesis && typeof window !== 'undefined') {
      try { window.speechSynthesis?.cancel() } catch { /* ignore */ }
      usingSynthesis = false
    }
  }

  return { speak, cancel }
}
