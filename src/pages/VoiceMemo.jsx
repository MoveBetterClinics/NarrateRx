import { useState, useRef, useEffect, useCallback } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth, useUser } from '@clerk/clerk-react'
import { ArrowLeft, Mic, Square, Trash2, Upload, Loader2, Play, Pause } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { useDocumentTitle } from '@/lib/useDocumentTitle'
import { toast } from '@/lib/toast'

/**
 * VoiceMemo — capture a voice memo via live recording or file upload, then
 * hand it off to /api/voice-memo for transcription + interview-row creation.
 *
 * Phase 1 decisions (2026-05-22):
 *   • No length cap client-side (server enforces if cost becomes an issue)
 *   • Both live record AND file upload supported
 *   • On successful upload → navigate to capture review page
 *
 * MediaRecorder mime-type detection: Chrome/Edge/Firefox prefer audio/webm
 * (opus); Safari supports audio/mp4. We pick the best supported type and let
 * the server normalize on receipt.
 */

const PREFERRED_MIME_TYPES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/mp4',
  'audio/mpeg',
]

function pickMimeType() {
  if (typeof MediaRecorder === 'undefined') return null
  for (const t of PREFERRED_MIME_TYPES) {
    if (MediaRecorder.isTypeSupported(t)) return t
  }
  return ''
}

function formatTime(sec) {
  const s = Math.floor(sec)
  const mm = Math.floor(s / 60).toString().padStart(2, '0')
  const ss = (s % 60).toString().padStart(2, '0')
  return `${mm}:${ss}`
}

export default function VoiceMemo() {
  useDocumentTitle('Voice memo')
  const navigate = useNavigate()
  const { user } = useUser()
  const { getToken } = useAuth()

  // state machine: idle | requesting | recording | recorded | uploading
  const [state, setState] = useState('idle')
  const [elapsed, setElapsed] = useState(0)
  const [error, setError] = useState('')
  const [blob, setBlob] = useState(null)
  const [blobUrl, setBlobUrl] = useState(null)
  const [filename, setFilename] = useState('')
  const [mimeType, setMimeType] = useState('')
  const [isPlaying, setIsPlaying] = useState(false)

  const mediaRecorderRef = useRef(null)
  const chunksRef = useRef([])
  const streamRef = useRef(null)
  const timerRef = useRef(null)
  const startTimeRef = useRef(0)
  const audioRef = useRef(null)
  const fileInputRef = useRef(null)

  // Release object URL when blob changes / unmounts so we don't leak.
  useEffect(() => {
    return () => {
      if (blobUrl) URL.revokeObjectURL(blobUrl)
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop())
      }
      if (timerRef.current) clearInterval(timerRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Recompute blobUrl whenever blob changes so the audio preview points at the
  // current capture (otherwise re-recording leaves the player on the old take).
  useEffect(() => {
    if (!blob) {
      setBlobUrl(null)
      return
    }
    const url = URL.createObjectURL(blob)
    setBlobUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [blob])

  const startRecording = useCallback(async () => {
    setError('')
    if (!navigator.mediaDevices?.getUserMedia) {
      setError("This browser doesn't support recording. Try uploading a file instead.")
      return
    }
    setState('requesting')
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream
      const mt = pickMimeType()
      const opts = mt ? { mimeType: mt } : {}
      const rec = new MediaRecorder(stream, opts)
      mediaRecorderRef.current = rec
      chunksRef.current = []
      rec.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunksRef.current.push(e.data)
      }
      rec.onstop = () => {
        const finalType = rec.mimeType || mt || 'audio/webm'
        const fullBlob = new Blob(chunksRef.current, { type: finalType })
        setBlob(fullBlob)
        setMimeType(finalType)
        setFilename(`voice-memo-${new Date().toISOString().replace(/[:.]/g, '-')}.${finalType.includes('mp4') ? 'm4a' : finalType.includes('mpeg') ? 'mp3' : 'webm'}`)
        if (streamRef.current) {
          streamRef.current.getTracks().forEach((t) => t.stop())
          streamRef.current = null
        }
        if (timerRef.current) {
          clearInterval(timerRef.current)
          timerRef.current = null
        }
        setState('recorded')
      }
      rec.start(1000) // collect chunks every 1s; helps with very long captures
      startTimeRef.current = Date.now()
      setElapsed(0)
      timerRef.current = setInterval(() => {
        setElapsed((Date.now() - startTimeRef.current) / 1000)
      }, 250)
      setState('recording')
    } catch (e) {
      setError(e?.message || 'Microphone access denied.')
      setState('idle')
    }
  }, [])

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop()
    }
  }, [])

  const discard = useCallback(() => {
    setBlob(null)
    setMimeType('')
    setFilename('')
    setElapsed(0)
    setIsPlaying(false)
    setError('')
    setState('idle')
  }, [])

  const onFilePicked = useCallback((e) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (!file.type.startsWith('audio/') && !/\.(mp3|m4a|wav|webm|ogg|aac|flac)$/i.test(file.name)) {
      setError("That doesn't look like an audio file. Pick an MP3, M4A, WAV, or similar.")
      return
    }
    setError('')
    setBlob(file)
    setMimeType(file.type || 'audio/mpeg')
    setFilename(file.name)
    setElapsed(0) // unknown until loadedmetadata fires
    setState('recorded')
  }, [])

  const onAudioLoaded = useCallback(() => {
    if (audioRef.current && Number.isFinite(audioRef.current.duration)) {
      setElapsed(audioRef.current.duration)
    }
  }, [])

  const togglePlay = useCallback(() => {
    if (!audioRef.current) return
    if (isPlaying) {
      audioRef.current.pause()
    } else {
      audioRef.current.play().catch(() => {})
    }
  }, [isPlaying])

  const upload = useCallback(async () => {
    if (!blob) return
    setError('')
    setState('uploading')
    try {
      const token = await getToken()
      // Send the audio as a raw binary body so the server can pipe it straight
      // to Vercel Blob without a multipart parser. Metadata travels via query
      // params (filename, durationSec) and the Content-Type header.
      const safeFilename = encodeURIComponent(filename || 'voice-memo.webm')
      const safeDuration = Math.round(elapsed)
      const r = await fetch(
        `/api/voice-memo?filename=${safeFilename}&durationSec=${safeDuration}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': mimeType || blob.type || 'audio/webm',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: blob,
        }
      )
      if (!r.ok) {
        const txt = await r.text().catch(() => '')
        throw new Error(txt || `Upload failed (${r.status})`)
      }
      const data = await r.json()
      const { clinicianId, interviewId } = data
      if (!interviewId) throw new Error('Upload succeeded but no interview id returned.')
      toast.success('Voice memo captured — review the transcript next.')
      navigate(`/capture/${clinicianId}/${interviewId}/review`)
    } catch (e) {
      setError(e?.message || 'Upload failed.')
      setState('recorded')
    }
  }, [blob, filename, mimeType, elapsed, getToken, navigate])

  const recording = state === 'recording'
  const requesting = state === 'requesting'
  const recorded = state === 'recorded'
  const uploading = state === 'uploading'

  return (
    <div className="max-w-lg mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" asChild>
          <Link to="/new">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Voice memo</h1>
          <p className="text-sm text-muted-foreground">
            Hit record, say what happened. Or upload an audio file you already have.
          </p>
        </div>
      </div>

      <Card>
        <CardContent className="p-6 space-y-5">
          {/* Recording or idle state — show the big mic */}
          {!recorded && !uploading && (
            <div className="flex flex-col items-center gap-4">
              <button
                type="button"
                onClick={recording ? stopRecording : startRecording}
                disabled={requesting}
                aria-label={recording ? 'Stop recording' : 'Start recording'}
                className={`h-24 w-24 rounded-full flex items-center justify-center transition shadow-sm focus:outline-none focus-visible:ring-4 focus-visible:ring-primary/30 ${
                  recording
                    ? 'bg-destructive text-destructive-foreground animate-pulse'
                    : 'bg-primary text-primary-foreground hover:bg-primary/90'
                }`}
              >
                {requesting ? (
                  <Loader2 className="h-9 w-9 animate-spin" />
                ) : recording ? (
                  <Square className="h-9 w-9" fill="currentColor" />
                ) : (
                  <Mic className="h-9 w-9" />
                )}
              </button>
              <div className="text-3xl font-mono tabular-nums text-foreground">
                {formatTime(elapsed)}
              </div>
              <div className="text-sm text-muted-foreground text-center">
                {recording
                  ? 'Recording… tap to stop.'
                  : requesting
                  ? 'Waiting for microphone…'
                  : 'Tap to start recording.'}
              </div>
            </div>
          )}

          {/* Recorded — preview + actions */}
          {recorded && (
            <div className="space-y-4">
              <div className="flex items-center gap-3 p-3 rounded-md bg-muted/40">
                <Button
                  type="button"
                  size="icon"
                  variant="secondary"
                  onClick={togglePlay}
                  aria-label={isPlaying ? 'Pause preview' : 'Play preview'}
                >
                  {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                </Button>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">{filename || 'voice memo'}</div>
                  <div className="text-xs text-muted-foreground tabular-nums">
                    {formatTime(elapsed)}{mimeType ? ` · ${mimeType.replace('audio/', '').split(';')[0]}` : ''}
                  </div>
                </div>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  onClick={discard}
                  aria-label="Discard and start over"
                  disabled={uploading}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>

              {blobUrl && (
                <audio
                  ref={audioRef}
                  src={blobUrl}
                  onLoadedMetadata={onAudioLoaded}
                  onPlay={() => setIsPlaying(true)}
                  onPause={() => setIsPlaying(false)}
                  onEnded={() => setIsPlaying(false)}
                  className="hidden"
                  preload="metadata"
                />
              )}

              <Button type="button" className="w-full" onClick={upload} disabled={uploading}>
                Continue → Transcribe & review
              </Button>
            </div>
          )}

          {/* Uploading */}
          {uploading && (
            <div className="flex flex-col items-center gap-3 py-6">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <div className="text-sm font-medium">Uploading & transcribing…</div>
              <div className="text-xs text-muted-foreground text-center max-w-xs">
                Long recordings take a bit. We&apos;ll route you to the review screen as soon as the transcript is ready.
              </div>
            </div>
          )}

          {error && (
            <div className="text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded-md p-3">
              {error}
            </div>
          )}
        </CardContent>
      </Card>

      {/* File upload alternative — always visible except while recording */}
      {!recording && !requesting && !uploading && (
        <Card>
          <CardContent className="p-5">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-md bg-muted text-muted-foreground flex items-center justify-center shrink-0">
                <Upload className="h-5 w-5" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium">Have a recording already?</div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  MP3, M4A, WAV, WebM — any length.
                </div>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => fileInputRef.current?.click()}
                disabled={recorded}
              >
                Choose file
              </Button>
              <input
                ref={fileInputRef}
                type="file"
                accept="audio/*,.mp3,.m4a,.wav,.webm,.ogg,.aac,.flac"
                onChange={onFilePicked}
                className="hidden"
              />
            </div>
            {!user && (
              <div className="mt-3 text-xs text-muted-foreground">
                Sign in to save your memo.
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  )
}
