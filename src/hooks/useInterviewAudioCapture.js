// useInterviewAudioCapture — MediaRecorder hook for interview voice capture.
//
// Records the clinician's microphone during a NarrateRx interview session.
// The captured audio is uploaded to Vercel Blob at completion and stored on
// interviews.audio_recording_url for later ElevenLabs voice clone re-training.
//
// Design constraints:
//   - NEVER breaks the interview if capture fails — all errors are swallowed
//     silently (logged to console only). The interview is the primary product.
//   - Records only the mic stream — NOT TTS/ElevenLabs playback. The training
//     corpus must be the clinician's own voice, nothing else.
//   - No-op on browsers without getUserMedia (e.g., HTTPS not met) or when
//     the user declines mic permission (permission was already granted for
//     Web Speech, so this should always be available).
//   - Fire-and-forget upload — stopAndUpload() resolves as soon as the upload
//     is dispatched; the interview can navigate away without waiting.
//
// Usage:
//   const { startCapture, stopAndUpload, isCapturing } = useInterviewAudioCapture()
//
//   // Start after mic check passes:
//   useEffect(() => { if (micCheckPassed) startCapture() }, [micCheckPassed])
//
//   // Upload before navigating away on completion:
//   await stopAndUpload(interviewId)  // non-blocking — returns immediately after dispatch

import { useRef, useState, useCallback } from 'react'
import { upload } from '@vercel/blob/client'

const AUDIO_UPLOAD_URL = '/api/interviews/audio'

// Prefer Opus/WebM (best compression for speech, widely supported).
// Fall back gracefully on Safari which uses MP4/AAC.
function bestMimeType() {
  const candidates = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/ogg;codecs=opus',
    'audio/mp4',
  ]
  for (const t of candidates) {
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(t)) return t
  }
  return ''   // let the browser pick
}

function extFromMime(mime) {
  if (mime.includes('ogg'))  return 'ogg'
  if (mime.includes('mp4'))  return 'mp4'
  return 'webm'
}

export function useInterviewAudioCapture() {
  const recorderRef   = useRef(null)
  const chunksRef     = useRef([])
  const streamRef     = useRef(null)
  const mimeTypeRef   = useRef('')
  const uploadedRef   = useRef(false)   // guard: only upload once per session
  const [isCapturing, setIsCapturing] = useState(false)

  const startCapture = useCallback(async () => {
    // No-op if already capturing, or in a non-browser environment.
    if (recorderRef.current) return
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) return

    try {
      // Re-use permission already granted by Web Speech API — same mic source.
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false })
      streamRef.current = stream

      const mimeType = bestMimeType()
      mimeTypeRef.current = mimeType

      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
      recorderRef.current = recorder
      chunksRef.current   = []

      recorder.ondataavailable = (e) => {
        if (e.data?.size > 0) chunksRef.current.push(e.data)
      }

      recorder.onerror = (e) => {
        console.warn('[audioCapture] MediaRecorder error:', e?.error?.message)
      }

      // Collect a chunk every 10 seconds so we don't lose everything on a crash.
      recorder.start(10_000)
      setIsCapturing(true)
    } catch (e) {
      // Permission denied, NotFoundError, or any other getUserMedia failure.
      // Log and continue — the interview must not be affected.
      console.warn('[audioCapture] startCapture failed (non-fatal):', e?.message)
    }
  }, [])

  const stopAndUpload = useCallback(async (interviewId) => {
    const recorder = recorderRef.current
    if (!recorder || uploadedRef.current) return
    if (!interviewId) return

    uploadedRef.current = true   // prevent double-upload on StrictMode double-fire

    return new Promise((resolve) => {
      recorder.onstop = async () => {
        // Stop mic track so the browser recording indicator clears immediately.
        streamRef.current?.getTracks().forEach((t) => t.stop())
        setIsCapturing(false)

        const chunks = chunksRef.current
        if (chunks.length === 0) { resolve(); return }

        const mime = mimeTypeRef.current || 'audio/webm'
        const blob = new Blob(chunks, { type: mime })

        // Minimum threshold: skip uploads under ~30 seconds of audio to avoid
        // polluting the training set with aborted sessions. At 64kbps that's
        // roughly 240KB; we use 200KB as the floor to stay conservative.
        if (blob.size < 200_000) {
          console.info(`[audioCapture] interview too short (${blob.size} bytes) — skipping upload`)
          resolve()
          return
        }

        const ext      = extFromMime(mime)
        const pathname = `interviews/audio/${interviewId}.${ext}`

        // Fire the upload; don't block the caller on completion.
        resolve()

        try {
          await upload(pathname, blob, {
            access:          'public',
            handleUploadUrl: AUDIO_UPLOAD_URL,
            clientPayload:   JSON.stringify({ interviewId }),
          })
          console.info(`[audioCapture] uploaded: ${pathname}`)
        } catch (e) {
          console.warn('[audioCapture] upload failed (non-fatal):', e?.message)
        }
      }

      if (recorder.state !== 'inactive') {
        recorder.stop()
      } else {
        // Already stopped somehow — fire onstop manually.
        recorder.onstop()
      }
    })
  }, [])

  return { startCapture, stopAndUpload, isCapturing }
}
