import { useState, useRef, useEffect } from 'react'
import { Link } from 'react-router-dom'
import {
  ArrowLeft, Camera, FolderOpen, Loader2, Upload, X, Check,
  Image as ImageIcon, AlertCircle, Smartphone,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Textarea } from '@/components/ui/textarea'
import { useDocumentTitle } from '@/lib/useDocumentTitle'
import { toast } from '@/lib/toast'
import { uploadMedia } from '@/lib/mediaLib'
import { useSelfClinicianId } from '@/lib/useSelfClinicianId'
import ShotListCard from '@/components/capture/ShotListCard'

// Universal capture page — PWA. Works on any device with a browser:
//   • Mobile: "Take photo or video" opens the device's native camera
//   • Mobile: "Pick existing" opens Photos / Files
//   • Desktop / iPad / Chromebook: "Pick existing" opens the file picker
//   • SD card workflow (e.g. ZV-1F → reader → desktop): use "Pick existing"
//
// Auth: existing Clerk session (this page sits inside ProtectedAppWithProvider).
// Upload: reuses uploadMedia() which calls @vercel/blob/client direct-to-Blob
// via /api/media/upload. Same path the desktop Media Library uses — zero new
// API code in this PR.
//
// This page is the UNIVERSAL upload pathway. The iOS Shortcut from Phase 1
// remains as an optional faster route for iOS users; it is no longer the
// gating mechanism for getting media into NarrateRx.

const MB = 1024 * 1024

function bytesLabel(n) {
  if (n < MB) return `${(n / 1024).toFixed(0)} KB`
  return `${(n / MB).toFixed(1)} MB`
}

function purposeForFile(file) {
  return (file.type || '').startsWith('video') ? 'broll' : 'photo'
}

export default function Capture() {
  useDocumentTitle('Capture')
  const clinicianId = useSelfClinicianId()

  const cameraInputRef = useRef(null)
  const filePickerRef = useRef(null)

  // pendingFiles: [{ file, previewUrl, progress, status, error, blobUrl }]
  // status: 'pending' | 'uploading' | 'done' | 'failed'
  const [pendingFiles, setPendingFiles] = useState([])
  const [sharedCaption, setSharedCaption] = useState('')
  const [isUploading, setIsUploading] = useState(false)

  // PWA install prompt — captured from the browser's beforeinstallprompt event.
  // Only fires when the app is not already installed and the browser supports PWA.
  // null = event hasn't fired (already installed, or browser doesn't support).
  const [installPrompt, setInstallPrompt] = useState(null)

  useEffect(() => {
    const handler = (e) => {
      e.preventDefault() // prevent the mini-infobar on Chrome Android
      setInstallPrompt(e)
    }
    window.addEventListener('beforeinstallprompt', handler)
    return () => window.removeEventListener('beforeinstallprompt', handler)
  }, [])

  const handleInstall = async () => {
    if (!installPrompt) return
    installPrompt.prompt()
    const { outcome } = await installPrompt.userChoice
    if (outcome === 'accepted') {
      setInstallPrompt(null) // banner gone once accepted
    }
  }

  // Cleanup object URLs on unmount to avoid leaks.
  useEffect(() => {
    return () => {
      for (const p of pendingFiles) {
        if (p.previewUrl) URL.revokeObjectURL(p.previewUrl)
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // V10 shooting director: a tapped directive seeds the capture note with its
  // intent and opens the camera, so the upload lands tagged with what it's
  // meant to cover. Video directives bias toward the camera; either way the
  // clinician can still pick existing files.
  const handlePickDirective = (d) => {
    setSharedCaption(d.directive || d.title || d.topic || '')
    cameraInputRef.current?.click()
  }

  const handleFilesPicked = (event) => {
    const files = Array.from(event.target.files || [])
    if (!files.length) return
    const newPending = files.map((file) => ({
      file,
      previewUrl: URL.createObjectURL(file),
      progress: 0,
      status: 'pending',
      error: null,
      blobUrl: null,
    }))
    setPendingFiles((prev) => [...prev, ...newPending])
    event.target.value = '' // allow re-picking the same file
  }

  const removePending = (idx) => {
    setPendingFiles((prev) => {
      const next = [...prev]
      const removed = next.splice(idx, 1)[0]
      if (removed?.previewUrl) URL.revokeObjectURL(removed.previewUrl)
      return next
    })
  }

  const clearAll = () => {
    for (const p of pendingFiles) {
      if (p.previewUrl) URL.revokeObjectURL(p.previewUrl)
    }
    setPendingFiles([])
    setSharedCaption('')
  }

  const uploadAll = async () => {
    setIsUploading(true)
    for (let i = 0; i < pendingFiles.length; i++) {
      if (pendingFiles[i].status === 'done') continue

      setPendingFiles((prev) => {
        const next = [...prev]
        next[i] = { ...next[i], status: 'uploading', progress: 0, error: null }
        return next
      })

      try {
        const p = pendingFiles[i]
        const blob = await uploadMedia(p.file, {
          clinicianId: clinicianId || null,
          notes: sharedCaption || null,
          assetPurpose: purposeForFile(p.file),
          capturedAt: new Date().toISOString(),
        }, {
          onProgress: (e) => {
            setPendingFiles((prev) => {
              const next = [...prev]
              if (next[i]) next[i] = { ...next[i], progress: e.percentage || 0 }
              return next
            })
          },
        })

        setPendingFiles((prev) => {
          const next = [...prev]
          if (next[i]) next[i] = { ...next[i], status: 'done', progress: 100, blobUrl: blob?.url || null }
          return next
        })
      } catch (e) {
        const msg = e?.message || 'upload failed'
        setPendingFiles((prev) => {
          const next = [...prev]
          if (next[i]) next[i] = { ...next[i], status: 'failed', error: msg }
          return next
        })
        toast.error(`Upload failed: ${msg}`)
      }
    }
    setIsUploading(false)
    const doneCount = pendingFiles.filter((p) => p.status === 'done').length + pendingFiles.filter((p) => p.status === 'pending').length
    if (doneCount > 0) {
      toast(`${doneCount} upload${doneCount === 1 ? '' : 's'} complete`)
    }
  }

  const allDone = pendingFiles.length > 0 && pendingFiles.every((f) => f.status === 'done')
  const hasPending = pendingFiles.some((f) => f.status === 'pending' || f.status === 'failed')
  const hasUploading = pendingFiles.some((f) => f.status === 'uploading')

  return (
    <div className="container mx-auto max-w-2xl px-4 py-6">
      <Link to="/" className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground mb-4">
        <ArrowLeft className="w-4 h-4 mr-1" /> Home
      </Link>

      <h1 className="text-2xl font-semibold mb-1">Capture</h1>
      <p className="text-sm text-muted-foreground mb-4">
        Snap a photo or short video, or pick existing files from anywhere. Works on any device with a camera or file browser.
      </p>

      {/* Add-to-Home-Screen install prompt — only visible when the browser fires
          beforeinstallprompt (Chrome/Edge on Android, Chrome on desktop).
          Hidden on iOS Safari (use Share → Add to Home Screen instead) and when
          already installed as a PWA. */}
      {installPrompt && (
        <button
          type="button"
          onClick={handleInstall}
          className="w-full flex items-center gap-3 px-4 py-3 mb-6 rounded-lg border border-primary/30 bg-primary/5 text-left hover:bg-primary/10 transition"
        >
          <Smartphone className="w-5 h-5 text-primary shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-primary">Add to Home Screen</p>
            <p className="text-xs text-primary/70">One tap to capture — no browser chrome, no sign-in wait</p>
          </div>
          <span className="text-xs font-medium text-primary shrink-0">Install</span>
        </button>
      )}

      {/* Shooting director (V10) — turns coverage gaps into capture directives.
          Renders nothing when there are no gaps or the feature is disabled. */}
      {pendingFiles.length === 0 && <ShotListCard onPick={handlePickDirective} />}

      {/* Capture entry points — only shown when nothing is queued */}
      {pendingFiles.length === 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-6">
          <button
            type="button"
            onClick={() => cameraInputRef.current?.click()}
            className="flex flex-col items-center justify-center gap-2 h-32 rounded-lg border-2 border-border hover:border-primary hover:bg-primary/5 transition"
          >
            <Camera className="w-8 h-8 text-primary" />
            <span className="font-medium">Take photo or video</span>
            <span className="text-xs text-muted-foreground">Opens device camera</span>
          </button>
          <input
            ref={cameraInputRef}
            type="file"
            accept="image/*,video/*"
            capture="environment"
            className="hidden"
            onChange={handleFilesPicked}
          />

          <button
            type="button"
            onClick={() => filePickerRef.current?.click()}
            className="flex flex-col items-center justify-center gap-2 h-32 rounded-lg border-2 border-border hover:border-primary hover:bg-primary/5 transition"
          >
            <FolderOpen className="w-8 h-8 text-primary" />
            <span className="font-medium">Pick existing files</span>
            <span className="text-xs text-muted-foreground">From Photos, SD card, or downloads</span>
          </button>
          <input
            ref={filePickerRef}
            type="file"
            accept="image/*,video/*"
            multiple
            className="hidden"
            onChange={handleFilesPicked}
          />
        </div>
      )}

      {/* Queued + uploaded files */}
      {pendingFiles.length > 0 && (
        <>
          <div className="space-y-3 mb-4">
            {pendingFiles.map((p, idx) => (
              <Card key={`${p.file.name}-${idx}`}>
                <CardContent className="pt-4 pb-4">
                  <div className="flex gap-3">
                    {(p.file.type || '').startsWith('video') ? (
                      <video src={p.previewUrl} className="w-20 h-20 object-cover rounded bg-muted flex-shrink-0" muted playsInline />
                    ) : (
                      <img src={p.previewUrl} alt="" className="w-20 h-20 object-cover rounded bg-muted flex-shrink-0" />
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <span className="text-sm font-medium truncate" title={p.file.name}>{p.file.name}</span>
                        <div className="flex-shrink-0">
                          {p.status === 'pending' && (
                            <button type="button" onClick={() => removePending(idx)} className="text-muted-foreground hover:text-foreground" aria-label="Remove">
                              <X className="w-4 h-4" />
                            </button>
                          )}
                          {p.status === 'uploading' && <Loader2 className="w-4 h-4 animate-spin text-primary" />}
                          {p.status === 'done' && <Check className="w-4 h-4 text-success" />}
                          {p.status === 'failed' && <AlertCircle className="w-4 h-4 text-destructive" />}
                        </div>
                      </div>
                      <div className="text-xs text-muted-foreground mb-1.5">
                        {bytesLabel(p.file.size)} · {p.file.type || 'unknown type'}
                      </div>
                      {p.status === 'uploading' && (
                        <div className="w-full bg-muted rounded h-1.5 overflow-hidden">
                          <div className="bg-primary h-1.5 transition-all" style={{ width: `${p.progress}%` }} />
                        </div>
                      )}
                      {p.status === 'failed' && p.error && (
                        <div className="text-xs text-destructive mt-1">{p.error}</div>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Shared caption — only relevant when there are unsent files */}
          {hasPending && (
            <div className="mb-4">
              <label htmlFor="shared-caption" className="text-sm font-medium block mb-1">Quick note (optional)</label>
              <Textarea
                id="shared-caption"
                value={sharedCaption}
                onChange={(e) => setSharedCaption(e.target.value)}
                placeholder="Applied to all selected files — e.g. who, what, treatment room"
                rows={2}
              />
            </div>
          )}

          {/* Actions */}
          <div className="flex flex-wrap gap-2">
            {!allDone && (
              <Button
                size="lg"
                className="flex-1 min-w-[200px]"
                onClick={uploadAll}
                disabled={isUploading || !hasPending}
              >
                {hasUploading
                  ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Uploading…</>
                  : <><Upload className="w-4 h-4 mr-2" /> Upload {pendingFiles.filter((p) => p.status !== 'done').length} file{pendingFiles.filter((p) => p.status !== 'done').length === 1 ? '' : 's'}</>}
              </Button>
            )}
            {allDone && (
              <>
                <Button
                  size="lg"
                  className="flex-1 min-w-[200px]"
                  onClick={clearAll}
                >
                  <Camera className="w-4 h-4 mr-2" /> Capture another
                </Button>
              </>
            )}
            <Button asChild variant="outline" size="lg">
              <Link to="/library">
                <ImageIcon className="w-4 h-4 mr-2" /> Library
              </Link>
            </Button>
          </div>

          {/* Add more (always available, even while uploading) */}
          {!allDone && (
            <div className="mt-3 text-center text-sm text-muted-foreground">
              or{' '}
              <button
                type="button"
                onClick={() => cameraInputRef.current?.click()}
                className="text-primary underline-offset-2 hover:underline"
                disabled={isUploading}
              >
                take another
              </button>
              {' · '}
              <button
                type="button"
                onClick={() => filePickerRef.current?.click()}
                className="text-primary underline-offset-2 hover:underline"
                disabled={isUploading}
              >
                pick more
              </button>
              <input
                ref={cameraInputRef}
                type="file"
                accept="image/*,video/*"
                capture="environment"
                className="hidden"
                onChange={handleFilesPicked}
              />
              <input
                ref={filePickerRef}
                type="file"
                accept="image/*,video/*"
                multiple
                className="hidden"
                onChange={handleFilesPicked}
              />
            </div>
          )}
        </>
      )}
    </div>
  )
}
