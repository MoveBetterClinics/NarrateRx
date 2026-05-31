/**
 * VideoAttachPrompt
 *
 * Shown at the end of an audio interview when the clinician recorded themselves
 * on an iPhone (or similar) and wants to attach that video. Appears between the
 * "interview complete" card and navigation to /stories/:id.
 *
 * Flow:
 *   1. "Did you record video?" — Yes / Skip
 *   2. File picker (video/* only, single file)
 *   3. Upload progress bar (reuses uploadMedia from mediaLib)
 *   4. Auto-detect offset: POST /api/interviews/detect-video-offset
 *      (ffmpeg silencedetect — finds where speech begins, skips setup silence)
 *   5. onDone() called → caller navigates to /stories/:id
 */

import { useState, useRef, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Video, Upload, SkipForward, CheckCircle2, AlertCircle, X } from 'lucide-react'
import { uploadMedia } from '@/lib/mediaLib'
import { apiFetch } from '@/lib/api'

export default function VideoAttachPrompt({ interviewId, staffName, onDone }) {
  const [step, setStep] = useState('ask') // ask | uploading | detecting | done | error
  const [file, setFile] = useState(null)
  const [uploadProgress, setUploadProgress] = useState(0)
  const [errorMsg, setErrorMsg] = useState('')
  const fileInputRef = useRef(null)
  const abortRef = useRef(null)

  const handleFileChange = useCallback(async (e) => {
    const f = e.target.files?.[0]
    if (!f) return
    if (!f.type.startsWith('video/')) {
      setErrorMsg('Please select a video file.')
      return
    }
    setFile(f)
    setStep('uploading')
    setUploadProgress(0)
    setErrorMsg('')

    const controller = new AbortController()
    abortRef.current = controller

    try {
      // 1. Upload to Blob / Mux
      const result = await uploadMedia(f, {
        purpose: 'interview',
        label: `${staffName} — interview video`,
      }, {
        abortSignal: controller.signal,
        onProgress: (ev) => setUploadProgress(Math.round(ev.percent ?? 0)),
      })

      setUploadProgress(100)
      setStep('detecting')

      // 2. Auto-detect speech onset (removes setup silence automatically)
      //    Non-fatal: if detection fails we still save with offset=0
      try {
        await apiFetch('/api/interviews/detect-video-offset', {
          method: 'POST',
          body: JSON.stringify({ interviewId, assetId: result.assetId }),
        })
      } catch (detectErr) {
        console.warn('[VideoAttachPrompt] offset detection failed (non-fatal):', detectErr?.message)
        // Still attach the video — just without auto-trim
      }

      setStep('done')
      setTimeout(() => onDone(), 1200)
    } catch (err) {
      if (err?.name === 'AbortError') return
      setErrorMsg(err?.message || 'Upload failed. Please try again.')
      setStep('error')
    }
  }, [staffName, interviewId, onDone])

  const handleCancel = useCallback(() => {
    abortRef.current?.abort()
    onDone()
  }, [onDone])

  // ── Ask step ─────────────────────────────────────────────────────────────
  if (step === 'ask') {
    return (
      <div className="flex flex-col items-center gap-5 py-6 px-4 max-w-sm mx-auto text-center">
        <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center">
          <Video className="h-6 w-6 text-primary" />
        </div>
        <div>
          <h2 className="text-lg font-semibold">Did you record video?</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Attach your iPhone recording and it&apos;ll be part of your content library.
          </p>
        </div>
        <div className="flex gap-3 w-full">
          <Button variant="outline" className="flex-1" onClick={handleCancel}>
            <SkipForward className="h-4 w-4 mr-1.5" />
            Skip
          </Button>
          <Button className="flex-1" onClick={() => fileInputRef.current?.click()}>
            <Upload className="h-4 w-4 mr-1.5" />
            Add video
          </Button>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept="video/*"
          className="sr-only"
          onChange={handleFileChange}
        />
      </div>
    )
  }

  // ── Uploading step ────────────────────────────────────────────────────────
  if (step === 'uploading') {
    return (
      <div className="flex flex-col items-center gap-5 py-6 px-4 max-w-sm mx-auto text-center">
        <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center">
          <Upload className="h-6 w-6 text-primary animate-pulse" />
        </div>
        <div className="w-full">
          <p className="text-sm font-medium mb-2">
            Uploading {file?.name ?? 'video'}…
          </p>
          <div className="w-full h-2 rounded-full bg-muted overflow-hidden">
            <div
              className="h-full bg-primary transition-all duration-300"
              style={{ width: `${uploadProgress}%` }}
            />
          </div>
          <p className="text-xs text-muted-foreground mt-1">{uploadProgress}%</p>
        </div>
        <Button variant="ghost" size="sm" onClick={handleCancel}>
          <X className="h-3.5 w-3.5 mr-1" />
          Cancel
        </Button>
      </div>
    )
  }

  // ── Detecting offset step ─────────────────────────────────────────────────
  if (step === 'detecting') {
    return (
      <div className="flex flex-col items-center gap-4 py-8 px-4 max-w-sm mx-auto text-center">
        <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center">
          <Video className="h-5 w-5 text-primary animate-pulse" />
        </div>
        <p className="text-sm font-medium">Finding interview start…</p>
        <p className="text-xs text-muted-foreground">Skipping setup time automatically</p>
      </div>
    )
  }

  // ── Done step ─────────────────────────────────────────────────────────────
  if (step === 'done') {
    return (
      <div className="flex flex-col items-center gap-4 py-8 px-4 max-w-sm mx-auto text-center">
        <div className="h-10 w-10 rounded-full bg-emerald-100 flex items-center justify-center">
          <CheckCircle2 className="h-5 w-5 text-emerald-600" />
        </div>
        <p className="text-sm font-medium">Video attached</p>
      </div>
    )
  }

  // ── Error step ────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col items-center gap-4 py-6 px-4 max-w-sm mx-auto text-center">
      <div className="h-10 w-10 rounded-full bg-destructive/10 flex items-center justify-center">
        <AlertCircle className="h-5 w-5 text-destructive" />
      </div>
      <div>
        <p className="text-sm font-medium">Upload failed</p>
        <p className="text-xs text-muted-foreground mt-1">{errorMsg}</p>
      </div>
      <div className="flex gap-3">
        <Button variant="outline" size="sm" onClick={handleCancel}>Skip for now</Button>
        <Button size="sm" onClick={() => { setStep('ask'); setErrorMsg('') }}>Try again</Button>
      </div>
    </div>
  )
}
