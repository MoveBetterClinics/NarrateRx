import { useState, useRef, useEffect, useCallback } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '@clerk/react'
import { ArrowLeft, Mic, Square, Trash2, Loader2, FileText } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { useDocumentTitle } from '@/lib/useDocumentTitle'

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

/**
 * Patient handout capture — Phase 5 Feature 4.
 *
 * A clinician records a 30–60 second voice memo immediately after a visit
 * ("I just saw a runner, post-op shoulder, gave her three movements…")
 * and NarrateRx generates a one-page handout in their voice. The server
 * uploads the audio, transcribes via Whisper, creates an interviews row
 * with capture_mode='patient_handout', generates the handout, inserts a
 * content_item, and we redirect straight to that piece for review.
 *
 * No discard-then-edit flow — clinical workflow demands instant output.
 * If the result needs editing, the user does that on the content detail
 * page (StoryDetail). If they want to start over, they record again from
 * this page.
 */
export default function HandoutCapture() {
  useDocumentTitle('Patient handout')
  const navigate = useNavigate()
  const { getToken } = useAuth()

  // idle | requesting | recording | recorded | uploading
  const [state, setState] = useState('idle')
  const [elapsed, setElapsed] = useState(0)
  const [error, setError] = useState('')
  const [blob, setBlob] = useState(null)
  const [blobUrl, setBlobUrl] = useState(null)
  const [mimeType, setMimeType] = useState('')

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
    if (!blob) { setBlobUrl(null); return undefined }
    const url = URL.createObjectURL(blob)
    setBlobUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [blob])

  // beforeunload — never let a clinician lose an unsent recording. Same
  // policy applied to /settings/voice-training in PR #812.
  useEffect(() => {
    const hasUnsaved = !!blob && state !== 'uploading'
    if (!hasUnsaved) return undefined
    const handler = (e) => { e.preventDefault(); e.returnValue = ''; return '' }
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
    if (mt === null) { setError("This browser doesn't support MediaRecorder."); return }
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
        if (streamRef.current) { streamRef.current.getTracks().forEach((t) => t.stop()); streamRef.current = null }
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
    setBlob(null); setElapsed(0); setError(''); setState('idle')
  }, [])

  const submit = useCallback(async () => {
    if (!blob) return
    setError('')
    setState('uploading')
    try {
      const token = await getToken()
      const filename = `handout-${Date.now()}.webm`
      const r = await fetch(
        `/api/handout/create?filename=${encodeURIComponent(filename)}` +
        `&durationSec=${Math.round(elapsed)}`,
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
        throw new Error(data?.error || `Failed (${r.status})`)
      }
      if (!data?.contentItemId) {
        throw new Error('Server returned no content item id')
      }
      navigate(`/stories/${data.contentItemId}`)
    } catch (e) {
      setError(e?.message || 'Generation failed.')
      setState('recorded')
    }
  }, [blob, elapsed, mimeType, getToken, navigate])

  const recording = state === 'recording'
  const recorded = state === 'recorded'
  const uploading = state === 'uploading'
  const requesting = state === 'requesting'

  return (
    <div className="mx-auto max-w-2xl px-4 py-6 space-y-6">
      <Link to="/new" className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4 mr-1" /> Back
      </Link>

      <div className="space-y-1">
        <h1 className="text-2xl font-semibold flex items-center gap-2">
          <FileText className="h-5 w-5 text-primary" /> Patient handout
        </h1>
        <p className="text-sm text-muted-foreground">
          Just say what happened — the patient, what you did, what they should do at home. About 30–60 seconds. NarrateRx writes a one-page handout in your voice.
        </p>
      </div>

      <Card>
        <CardContent className="p-4 space-y-2 text-sm">
          <div className="font-medium">What to include in the memo</div>
          <ul className="list-disc list-inside text-muted-foreground space-y-1">
            <li>Who they are, generally (&quot;a runner with chronic ankle pain&quot;) — <strong>no names</strong></li>
            <li>What you did in the session</li>
            <li>What they should do at home this week</li>
            <li>What to watch for, and when to come back</li>
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-6 space-y-4">
          <div className="flex flex-col items-center gap-3">
            <Button
              type="button"
              onClick={recording ? stopRecording : startRecording}
              disabled={uploading || requesting}
              aria-label={recording ? 'Stop recording' : 'Start recording'}
              className={`h-20 w-20 rounded-full p-0 ${recording ? 'bg-red-600 hover:bg-red-700' : ''}`}
            >
              {requesting ? <Loader2 className="h-7 w-7 animate-spin" />
                : recording ? <Square className="h-7 w-7" fill="currentColor" />
                : <Mic className="h-7 w-7" />}
            </Button>
            <div className="text-3xl font-mono tabular-nums">{formatTime(elapsed)}</div>
            <div className="text-xs text-muted-foreground">
              {recording ? 'Recording — tap to stop.'
                : recorded ? 'Ready to generate.'
                : 'Tap to start.'}
            </div>
          </div>

          {recorded && blobUrl && (
            <div className="space-y-3 pt-2">
              <audio ref={audioRef} src={blobUrl} className="w-full" controls />
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="outline" onClick={discard} disabled={uploading}>
                  <Trash2 className="h-4 w-4 mr-1" /> Discard
                </Button>
                <Button type="button" className="ml-auto" onClick={submit} disabled={uploading}>
                  {uploading ? (
                    <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Generating handout…</>
                  ) : (
                    'Generate handout'
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
              Transcribing and writing — takes ~15–30 seconds.
            </div>
          )}
        </CardContent>
      </Card>

      <div className="text-xs text-muted-foreground space-y-1">
        <p><strong>No patient details are stored.</strong> Don&apos;t say the patient&apos;s name — &quot;the runner I saw today&quot; is enough. NarrateRx generalizes any identifying details out of the handout, and you add the patient name by hand when you print or email it.</p>
      </div>
    </div>
  )
}
