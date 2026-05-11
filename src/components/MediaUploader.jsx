import { useRef, useState } from 'react'
import { Upload, Loader2, AlertCircle, CheckCircle2, Stethoscope, Briefcase, UserCircle, AlertTriangle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { uploadMedia } from '@/lib/mediaLib'

// The speaker role drives how AI processes each upload — clinician captures
// surface treatment pearls, admin captures surface operational stories, and
// patient-guest captures require consent verification before AI even runs.
// We render this as a deliberate workflow step (not a small dropdown) so
// users feel the weight of the choice.
const SPEAKER_ROLES = [
  {
    id: 'clinician',
    label: 'Clinician',
    sublabel: 'In clinic, treating a patient',
    icon: Stethoscope,
  },
  {
    id: 'admin',
    label: 'Admin staff',
    sublabel: 'Operations or business interview',
    icon: Briefcase,
  },
  {
    id: 'patient_guest',
    label: 'Patient guest',
    sublabel: 'Patient telling their story (consent required)',
    icon: UserCircle,
  },
]

// Hard caps the user sees before the upload kicks off. The server still has
// the last word (Vercel Blob enforces its own plan-level limits + handleUpload
// can reject), but failing fast here keeps the user from staring at a 0%
// progress bar for ten seconds on an obviously-too-big file.
const MAX_VIDEO_BYTES = 2 * 1024 * 1024 * 1024  // 2 GB — covers a long clinical clip
const MAX_IMAGE_BYTES = 50 * 1024 * 1024        // 50 MB — covers raw camera output

// We accept the broad image/* + video/* via <input accept>, but reject obvious
// non-media that ends up in the drop zone via drag-and-drop (browsers don't
// honor `accept` on drop). Empty type === unknown; let those through and let
// the server decide.
function checkFile(file) {
  const t = file.type || ''
  if (t && !t.startsWith('image/') && !t.startsWith('video/')) {
    return `Unsupported file type (${t}). Only images and videos are accepted.`
  }
  const isVideo = t.startsWith('video/')
  const cap = isVideo ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES
  if (file.size > cap) {
    const mb = (cap / (1024 * 1024)).toFixed(0)
    return `File is too large (max ${mb} MB for ${isVideo ? 'video' : 'images'}).`
  }
  return null
}

// Drag-drop / click uploader for the Media Hub.
// Multiple files supported; uploads run in parallel.
export default function MediaUploader({ onUploaded, createdBy }) {
  const inputRef = useRef(null)
  const [dragOver, setDragOver]    = useState(false)
  const [uploads, setUploads]      = useState([])  // [{ id, name, status, error?, progress?, transcoding? }]
  const [speakerRole, setSpeakerRole] = useState('clinician')

  async function handleFiles(fileList) {
    const files = Array.from(fileList || [])
    if (!files.length) return

    // Pre-validate each file before kicking off any upload. Failures still
    // appear as rows so the user sees what was rejected and why; only the
    // ones that pass make the network round trip.
    const newRows = files.map((f) => {
      const error = checkFile(f)
      return error
        ? { id: crypto.randomUUID(), name: f.name, status: 'error', error }
        : { id: crypto.randomUUID(), name: f.name, status: 'uploading', progress: 0, transcoding: false }
    })
    setUploads((prev) => [...newRows, ...prev])

    await Promise.all(files.map(async (file, i) => {
      const row = newRows[i]
      if (row.status === 'error') return  // pre-validated reject — skip upload
      const rowId = row.id
      try {
        await uploadMedia(
          file,
          { createdBy: createdBy || null, speakerRole },
          {
            onTranscodeStart: () => setUploads((prev) => prev.map((r) =>
              r.id === rowId ? { ...r, transcoding: true } : r,
            )),
            onTranscodeEnd: () => setUploads((prev) => prev.map((r) =>
              r.id === rowId ? { ...r, transcoding: false } : r,
            )),
            // Vercel Blob's onUploadProgress event: { loaded, total, percentage }.
            // We cap state writes at the integer-percentage granularity so
            // a 1.2 GB file doesn't trigger a setState per chunk.
            onProgress: (e) => {
              const pct = typeof e.percentage === 'number'
                ? Math.round(e.percentage)
                : (e.total ? Math.round((e.loaded / e.total) * 100) : 0)
              setUploads((prev) => prev.map((r) =>
                r.id === rowId && r.progress !== pct ? { ...r, progress: pct } : r,
              ))
            },
          },
        )
        setUploads((prev) => prev.map((r) => r.id === rowId ? { ...r, status: 'done', progress: 100, transcoding: false } : r))
      } catch (e) {
        setUploads((prev) => prev.map((r) => r.id === rowId ? { ...r, status: 'error', error: e.message, transcoding: false } : r))
      }
    }))

    onUploaded?.()
  }

  function handleDrop(e) {
    e.preventDefault()
    setDragOver(false)
    handleFiles(e.dataTransfer.files)
  }

  return (
    <div>
      {/* Step 1 — speaker role. Numbered + radio cards make this read as a
          deliberate workflow step, not an optional sidebar setting. */}
      <div className="mb-3 rounded-xl border bg-card p-4">
        <div className="flex items-center gap-2 mb-2.5">
          <span className="inline-flex items-center justify-center h-6 w-6 rounded-full bg-primary text-white text-xs font-semibold">1</span>
          <div>
            <div className="text-sm font-semibold">
              Who's speaking in these clips? <span className="text-destructive">*</span>
            </div>
            <p className="text-[11px] text-muted-foreground">
              This shapes how AI reviews the upload. Pick before dropping files.
            </p>
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          {SPEAKER_ROLES.map((r) => {
            const Icon = r.icon
            const active = speakerRole === r.id
            return (
              <button
                type="button"
                key={r.id}
                onClick={() => setSpeakerRole(r.id)}
                className={`text-left rounded-lg border-2 p-2.5 transition-colors ${
                  active
                    ? 'border-primary bg-primary/5'
                    : 'border-border hover:border-primary/40'
                }`}
              >
                <div className="flex items-center gap-2">
                  <Icon className={`h-4 w-4 ${active ? 'text-primary' : 'text-muted-foreground'}`} />
                  <span className={`text-sm font-medium ${active ? 'text-primary' : ''}`}>{r.label}</span>
                </div>
                <div className="text-[11px] text-muted-foreground mt-0.5 leading-snug">
                  {r.sublabel}
                </div>
              </button>
            )
          })}
        </div>
        {speakerRole === 'patient_guest' && (
          <div className="mt-2.5 flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-950/30 p-2.5">
            <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
            <p className="text-xs text-amber-900 dark:text-amber-200">
              Verify written consent from the patient before uploading. Patient-guest content cannot be published without it.
            </p>
          </div>
        )}
      </div>

      {/* Step 2 — drop zone. Numbered + tied visually to step 1. */}
      <div className="rounded-xl border bg-card p-4">
        <div className="flex items-center gap-2 mb-2.5">
          <span className="inline-flex items-center justify-center h-6 w-6 rounded-full bg-primary text-white text-xs font-semibold">2</span>
          <div>
            <div className="text-sm font-semibold">Drop your files</div>
            <p className="text-[11px] text-muted-foreground">
              JPG, PNG, HEIC, MP4, MOV — uploads go to your private library. Max 50 MB images, 2 GB videos.
            </p>
          </div>
        </div>
        <div
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors ${
            dragOver ? 'border-primary bg-accent/30' : 'border-border hover:border-primary/50 hover:bg-accent/20'
          }`}
        >
          <Upload className="h-8 w-8 text-muted-foreground/50 mx-auto mb-2" />
          <p className="text-sm font-medium mb-0.5">Drop photos or videos here, or click to browse</p>
          <p className="text-xs text-muted-foreground">Speaker role above will be applied to every file in this batch.</p>
        </div>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/*,video/*"
        multiple
        className="hidden"
        onChange={(e) => handleFiles(e.target.files)}
      />

      {uploads.length > 0 && (
        <div className="mt-3 space-y-1.5">
          {uploads.map((r) => (
            <div key={r.id} className="flex items-center gap-2 text-xs px-2.5 py-1.5 rounded-md bg-muted/40">
              {r.status === 'uploading' && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground shrink-0" />}
              {r.status === 'done'      && <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 shrink-0" />}
              {r.status === 'error'     && <AlertCircle  className="h-3.5 w-3.5 text-destructive shrink-0" />}
              <span className="truncate flex-1">{r.name}</span>
              {r.status === 'uploading' && (
                <>
                  {r.transcoding ? (
                    <span className="text-[10px] text-muted-foreground shrink-0">Converting HEIC…</span>
                  ) : (
                    <>
                      {/* Determinate progress bar — replaces the prior spinner-
                          only state which gave no signal on a 1 GB upload. */}
                      <div className="w-20 h-1.5 rounded-full bg-muted overflow-hidden shrink-0" role="progressbar" aria-valuenow={r.progress || 0} aria-valuemin="0" aria-valuemax="100">
                        <div
                          className="h-full bg-primary transition-[width] duration-200"
                          style={{ width: `${Math.min(100, Math.max(0, r.progress || 0))}%` }}
                        />
                      </div>
                      <span className="tabular-nums text-[10px] text-muted-foreground w-9 text-right shrink-0">
                        {r.progress || 0}%
                      </span>
                    </>
                  )}
                </>
              )}
              {r.status === 'error' && <span className="text-destructive truncate max-w-[40%]">{r.error}</span>}
            </div>
          ))}
          {uploads.some((r) => r.status === 'done') && (
            <Button variant="ghost" size="sm" className="text-xs h-7" onClick={() => setUploads((prev) => prev.filter((r) => r.status !== 'done'))}>
              Clear finished
            </Button>
          )}
        </div>
      )}
    </div>
  )
}
