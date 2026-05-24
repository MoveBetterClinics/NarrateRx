import { useState, useRef, useEffect, useCallback } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '@clerk/clerk-react'
import { ArrowLeft, Mic, Square, Trash2, Loader2, Play, Pause, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { useDocumentTitle } from '@/lib/useDocumentTitle'
import { toast } from '@/lib/toast'
import { useSelfClinicianId } from '@/lib/useSelfClinicianId'

// Reading script for the IVC sample — diverse phonemes, conversational
// pacing, clinical context. ~3.5 min when read at natural pace.
const READING_SCRIPT = `Hi, I'm recording this short sample so my own voice can read what I write going forward.

I work with people who hurt, and most of the time the answer isn't a single perfect exercise — it's understanding what they're actually doing when their day goes sideways. When someone tells me their back has been bothering them for six weeks, I want to know what changed eight weeks ago, not just where it hurts today.

A lot of what I do is translation: from how a patient describes a problem into what we can actually load, and from what we test in the clinic into something they can keep up at home. The best programs are the ones that fit in the cracks of a real life. Three minutes between meetings, a set on the kitchen floor before bed, a walk that's slightly longer than yesterday's.

If you're listening to this, it's because I want what comes out the other end to sound like me, not a tool. The story is mine. The tool just helps me tell it.`

const PREFERRED_MIME_TYPES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/mp4',
  'audio/mpeg',
]

const MIN_DURATION_SEC = 60
const RECOMMENDED_DURATION_SEC = 180

// Resume-from-failed-upload stash: when /api/voice-clone/create succeeds in
// uploading the audio but the upstream clone step fails, we keep the blob
// URL here so the user can retry without re-recording. Keyed by clinicianId
// because different clinicians could share a browser.
const STASH_KEY = 'narraterx.voice-clone.pending.v1'
const STASH_TTL_MS = 24 * 60 * 60 * 1000

function loadStash(clinicianId) {
  if (!clinicianId || typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(STASH_KEY)
    if (!raw) return null
    const all = JSON.parse(raw)
    const entry = all?.[clinicianId]
    if (!entry?.sampleUrl || !entry?.recordedAt) return null
    if (Date.now() - new Date(entry.recordedAt).getTime() > STASH_TTL_MS) {
      saveStash(clinicianId, null)
      return null
    }
    return entry
  } catch { return null }
}

function saveStash(clinicianId, entry) {
  if (!clinicianId || typeof window === 'undefined') return
  try {
    const raw = window.localStorage.getItem(STASH_KEY)
    const all = raw ? JSON.parse(raw) : {}
    if (entry) all[clinicianId] = entry
    else delete all[clinicianId]
    window.localStorage.setItem(STASH_KEY, JSON.stringify(all))
  } catch { /* localStorage full or blocked — silent */ }
}

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

export default function VoiceTraining() {
  useDocumentTitle('Voice training')
  const navigate = useNavigate()
  const { getToken } = useAuth()
  const clinicianId = useSelfClinicianId()

  // idle | requesting | recording | recorded | uploading
  const [state, setState] = useState('idle')
  const [elapsed, setElapsed] = useState(0)
  const [error, setError] = useState('')
  const [blob, setBlob] = useState(null)
  const [blobUrl, setBlobUrl] = useState(null)
  const [mimeType, setMimeType] = useState('')
  const [isPlaying, setIsPlaying] = useState(false)

  // Resumable stash from a prior failed-upstream attempt for this clinician.
  // Set on mount via loadStash(); cleared on successful clone OR explicit dismiss.
  const [pendingStash, setPendingStash] = useState(null)
  const [resuming, setResuming] = useState(false)

  const mediaRecorderRef = useRef(null)
  const chunksRef = useRef([])
  const streamRef = useRef(null)
  const timerRef = useRef(null)
  const startTimeRef = useRef(0)
  const audioRef = useRef(null)

  useEffect(() => {
    return () => {
      if (blobUrl) URL.revokeObjectURL(blobUrl)
      if (streamRef.current) streamRef.current.getTracks().forEach((t) => t.stop())
      if (timerRef.current) clearInterval(timerRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!blob) {
      setBlobUrl(null)
      return undefined
    }
    const url = URL.createObjectURL(blob)
    setBlobUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [blob])

  // Load any pending resume stash once we know the clinician id.
  useEffect(() => {
    if (!clinicianId) return
    const entry = loadStash(clinicianId)
    if (entry) setPendingStash(entry)
  }, [clinicianId])

  // Warn before leaving the page when an unsaved recording is present.
  // beforeunload fires on tab close, reload, or hard navigation; React Router
  // internal navigation needs a separate guard, but the highest-cost loss
  // events (reload, accidental close) are the ones this covers.
  useEffect(() => {
    const hasUnsavedRecording = !!blob && state !== 'uploading'
    if (!hasUnsavedRecording) return undefined
    const handler = (e) => {
      e.preventDefault()
      e.returnValue = ''
      return ''
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [blob, state])

  const startRecording = useCallback(async () => {
    setError('')
    if (!('mediaDevices' in navigator) || typeof MediaRecorder === 'undefined') {
      setError("This browser doesn't support recording. Try Chrome, Edge, or Safari.")
      return
    }
    const mt = pickMimeType()
    if (mt === null) {
      setError("This browser doesn't support MediaRecorder.")
      return
    }
    setState('requesting')
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream
      const recorder = new MediaRecorder(stream, mt ? { mimeType: mt } : undefined)
      mediaRecorderRef.current = recorder
      chunksRef.current = []
      setMimeType(mt)

      recorder.ondataavailable = (e) => { if (e.data?.size) chunksRef.current.push(e.data) }
      recorder.onstop = () => {
        const out = new Blob(chunksRef.current, { type: mt || 'audio/webm' })
        setBlob(out)
        setState('recorded')
        if (streamRef.current) {
          streamRef.current.getTracks().forEach((t) => t.stop())
          streamRef.current = null
        }
        if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null }
      }

      recorder.start(1000)
      startTimeRef.current = Date.now()
      setElapsed(0)
      timerRef.current = setInterval(() => {
        setElapsed((Date.now() - startTimeRef.current) / 1000)
      }, 250)
      setState('recording')
    } catch (e) {
      setError(e?.message || 'Could not access microphone.')
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
    setElapsed(0)
    setError('')
    setIsPlaying(false)
    setState('idle')
  }, [])

  const togglePlayback = useCallback(() => {
    if (!audioRef.current) return
    if (isPlaying) audioRef.current.pause()
    else audioRef.current.play().catch(() => {})
  }, [isPlaying])

  const submit = useCallback(async () => {
    if (!blob || !clinicianId) return
    if (elapsed < MIN_DURATION_SEC) {
      setError(`Recording is ${Math.round(elapsed)}s — need at least ${MIN_DURATION_SEC}s for a usable clone.`)
      return
    }
    setError('')
    setState('uploading')
    try {
      const token = await getToken()
      const filename = `voice-training-${Date.now()}.webm`
      const r = await fetch(
        `/api/voice-clone/create?clinicianId=${encodeURIComponent(clinicianId)}` +
        `&durationSec=${Math.round(elapsed)}` +
        `&filename=${encodeURIComponent(filename)}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': mimeType || blob.type || 'audio/webm',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: blob,
        },
      )
      const data = await r.json().catch(() => ({}))
      if (!r.ok) {
        // If the server got far enough to upload the audio but then failed
        // upstream, it returns the sampleUrl. Stash it so a retry on the
        // same browser doesn't ask the clinician to re-record.
        if (data?.sampleUrl) {
          const stash = {
            sampleUrl:    data.sampleUrl,
            durationSec:  Math.round(elapsed),
            filename,
            recordedAt:   new Date().toISOString(),
          }
          saveStash(clinicianId, stash)
          setPendingStash(stash)
        }
        throw new Error(data?.error || `Upload failed (${r.status})`)
      }
      // Success — clear any prior stash.
      saveStash(clinicianId, null)
      setPendingStash(null)
      toast.success('Voice clone created — content can now use your voice.')
      navigate(`/clinician/${clinicianId}?tab=voice`)
    } catch (e) {
      setError(e?.message || 'Voice cloning failed.')
      setState('recorded')
    }
  }, [blob, clinicianId, elapsed, mimeType, getToken, navigate])

  // Resume a prior failed clone using the stashed sampleUrl. Skips re-record
  // and re-upload — server pulls the existing blob and calls ElevenLabs.
  const resume = useCallback(async () => {
    if (!pendingStash || !clinicianId) return
    setError('')
    setResuming(true)
    try {
      const token = await getToken()
      const r = await fetch('/api/voice-clone/resume', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          clinicianId,
          sampleUrl: pendingStash.sampleUrl,
        }),
      })
      const data = await r.json().catch(() => ({}))
      if (!r.ok) {
        // 410 means the blob is gone — clear the stash so we don't keep
        // offering a dead-end resume button.
        if (r.status === 410) {
          saveStash(clinicianId, null)
          setPendingStash(null)
        }
        throw new Error(data?.error || `Resume failed (${r.status})`)
      }
      saveStash(clinicianId, null)
      setPendingStash(null)
      toast.success('Voice clone created — content can now use your voice.')
      navigate(`/clinician/${clinicianId}?tab=voice`)
    } catch (e) {
      setError(e?.message || 'Resume failed.')
    } finally {
      setResuming(false)
    }
  }, [pendingStash, clinicianId, getToken, navigate])

  const dismissStash = useCallback(() => {
    if (!clinicianId) return
    saveStash(clinicianId, null)
    setPendingStash(null)
  }, [clinicianId])

  const recording = state === 'recording'
  const recorded = state === 'recorded'
  const uploading = state === 'uploading'
  const requesting = state === 'requesting'
  const meetsMin = elapsed >= MIN_DURATION_SEC

  return (
    <div className="mx-auto max-w-2xl px-4 py-6 space-y-6">
      <Link
        to={clinicianId ? `/clinician/${clinicianId}?tab=voice` : '/'}
        className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4 mr-1" /> Back to profile
      </Link>

      <div className="space-y-1">
        <h1 className="text-2xl font-semibold flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-primary" /> Voice training
        </h1>
        <p className="text-sm text-muted-foreground">
          Record yourself reading the passage below — about 3 minutes works best. After you submit, NarrateRx will create a voice clone you can use for blog audio, handouts, and other narration.
        </p>
        {!clinicianId && (
          <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-2 mt-2">
            You don&apos;t have a clinician profile in this workspace yet — complete your first interview before training a voice clone.
          </p>
        )}
      </div>

      {pendingStash && !recorded && !uploading && (
        <Card className="border-primary/40 bg-primary/5">
          <CardContent className="p-4 space-y-3">
            <div className="flex items-start gap-3">
              <Sparkles className="h-5 w-5 text-primary mt-0.5 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold">Resume your last recording?</div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  We saved your last sample ({pendingStash.durationSec}s, recorded {new Date(pendingStash.recordedAt).toLocaleString()}). The clone step failed last time — you can try again without re-recording.
                </div>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button type="button" size="sm" onClick={resume} disabled={resuming}>
                {resuming ? (
                  <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Cloning…</>
                ) : (
                  'Resume from last recording'
                )}
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={dismissStash} disabled={resuming}>
                Discard and record fresh
              </Button>
            </div>
            {error && (
              <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2">{error}</div>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="p-4 space-y-2">
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Read this aloud</div>
          <div className="whitespace-pre-wrap text-base leading-relaxed text-foreground">{READING_SCRIPT}</div>
          <div className="text-xs text-muted-foreground pt-2">
            Or speak freely on a topic you know well. Recommended: {RECOMMENDED_DURATION_SEC / 60} minutes minimum.
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-6 space-y-4">
          <div className="flex flex-col items-center gap-3">
            <Button
              type="button"
              onClick={recording ? stopRecording : startRecording}
              disabled={uploading || requesting || !clinicianId}
              aria-label={recording ? 'Stop recording' : 'Start recording'}
              className={`h-20 w-20 rounded-full p-0 ${recording ? 'bg-red-600 hover:bg-red-700' : ''}`}
            >
              {requesting ? (
                <Loader2 className="h-7 w-7 animate-spin" />
              ) : recording ? (
                <Square className="h-7 w-7" fill="currentColor" />
              ) : (
                <Mic className="h-7 w-7" />
              )}
            </Button>
            <div className="text-3xl font-mono tabular-nums">{formatTime(elapsed)}</div>
            <div className="text-xs text-muted-foreground">
              {recording
                ? meetsMin ? 'Long enough — keep going for best quality.' : `${MIN_DURATION_SEC - Math.floor(elapsed)}s until the minimum is met.`
                : recorded
                ? meetsMin ? 'Ready to submit.' : `Too short — re-record for at least ${MIN_DURATION_SEC}s.`
                : 'Tap to start.'}
            </div>
          </div>

          {recorded && blobUrl && (
            <div className="space-y-3 pt-2">
              <audio
                ref={audioRef}
                src={blobUrl}
                onPlay={() => setIsPlaying(true)}
                onPause={() => setIsPlaying(false)}
                onEnded={() => setIsPlaying(false)}
                className="w-full"
                controls
              />
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="outline" onClick={togglePlayback}>
                  {isPlaying ? <Pause className="h-4 w-4 mr-1" /> : <Play className="h-4 w-4 mr-1" />}
                  {isPlaying ? 'Pause' : 'Play'}
                </Button>
                <Button type="button" variant="outline" onClick={discard}>
                  <Trash2 className="h-4 w-4 mr-1" /> Discard
                </Button>
                <Button type="button" className="ml-auto" onClick={submit} disabled={uploading || !meetsMin}>
                  {uploading ? (
                    <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Creating clone…</>
                  ) : (
                    'Create my voice clone'
                  )}
                </Button>
              </div>
            </div>
          )}

          {error && (
            <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2">{error}</div>
          )}

          {uploading && (
            <div className="text-xs text-muted-foreground text-center pt-2">
              Uploading and cloning — this takes ~15–30 seconds.
            </div>
          )}
        </CardContent>
      </Card>

      <div className="text-xs text-muted-foreground space-y-1">
        <p><strong>By submitting,</strong> you consent to NarrateRx storing this sample and creating a voice clone at ElevenLabs that NarrateRx can use to narrate content tied to you.</p>
        <p>You can revoke the clone any time from your profile&apos;s Voice tab — the voice is deleted from ElevenLabs and stops being used immediately.</p>
      </div>
    </div>
  )
}
