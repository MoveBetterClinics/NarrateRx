import { useRef, useState } from 'react'
import {
  Upload, AlertCircle,
  Stethoscope, Briefcase, UserCircle, AlertTriangle,
  Mic, Film, Image as ImageIcon, Sparkles,
} from 'lucide-react'
import { useUploadProgress } from '@/lib/UploadProgressContext'

// Asset purpose is the primary fork — it decides which downstream pipeline
// the upload feeds. We render the choice as deliberate cards (not a dropdown)
// because picking the wrong one routes the upload through the wrong AI prompt
// and queues unwanted edit briefs.
//
//   interview — someone speaking on camera; runs the segmenter, produces
//               edit briefs for the contractor.
//   broll     — treatment/interaction footage with no spoken narrative;
//               tagged for search, no segmenter, no briefs.
//   photo     — clinic, team, equipment, before/after, social shots.
//   brand     — logos, headshots, graphics (lives in Brand Kit too).
const PURPOSES = [
  {
    id: 'interview',
    label: 'Interview clip',
    sublabel: 'Someone speaking on camera — clinician, admin, or patient',
    icon: Mic,
    accept: 'video/*',
    // Tag the input as video-only so the file picker biases correctly,
    // but server still validates on completion.
  },
  {
    id: 'broll',
    label: 'B-roll video',
    sublabel: 'Treatment, interaction, atmosphere — no spoken narrative',
    icon: Film,
    accept: 'video/*',
  },
  {
    id: 'photo',
    label: 'Photo',
    sublabel: 'Clinic, team, equipment, before/after, social',
    icon: ImageIcon,
    accept: 'image/*',
  },
  {
    id: 'brand',
    label: 'Brand asset',
    sublabel: 'Logos, headshots, graphics, icons',
    icon: Sparkles,
    accept: 'image/*,video/*',
  },
]

// Only shown when purpose === 'interview'. Drives the segmenter prompt
// (clinical pearls vs. operational story vs. patient testimony) and the
// consent surface for patient-guest uploads.
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

const MAX_VIDEO_BYTES = 2 * 1024 * 1024 * 1024
const MAX_IMAGE_BYTES = 50 * 1024 * 1024

// Per-purpose accept rules, used both for the <input accept> attribute and
// for the drop-zone validator. Browsers don't honor `accept` on drag-and-drop
// so we re-check after drop. Brand can be either kind; everything else is
// kind-locked to keep the file picker honest.
function acceptsKind(purpose, kind) {
  if (purpose === 'photo')  return kind === 'image'
  if (purpose === 'broll' || purpose === 'interview') return kind === 'video'
  if (purpose === 'brand')  return kind === 'image' || kind === 'video'
  return false
}

function kindFromType(t) {
  if (!t) return null
  if (t.startsWith('image/')) return 'image'
  if (t.startsWith('video/')) return 'video'
  return null
}

function checkFile(file, purpose) {
  const t = file.type || ''
  const kind = kindFromType(t)
  if (t && !kind) {
    return `Unsupported file type (${t}). Only images and videos are accepted.`
  }
  if (kind && !acceptsKind(purpose, kind)) {
    const expected = purpose === 'photo' ? 'a photo' :
                     purpose === 'interview' ? 'a video' :
                     purpose === 'broll' ? 'a video' :
                     'an image or video'
    return `This file is a ${kind} but the selected purpose expects ${expected}. Switch purpose above or pick a different file.`
  }
  const isVideo = kind === 'video'
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
  // Pre-upload validation errors only — actual progress lives in the
  // app-wide UploadProgressContext and is rendered by <UploadTray/>.
  const [rejected, setRejected]    = useState([])
  const [purpose, setPurpose]      = useState('interview')
  const [speakerRole, setSpeakerRole] = useState('clinician')
  const { startUpload } = useUploadProgress()

  const purposeMeta = PURPOSES.find((p) => p.id === purpose) || PURPOSES[0]
  const showSpeakerRole = purpose === 'interview'

  async function handleFiles(fileList) {
    const files = Array.from(fileList || [])
    if (!files.length) return

    // Split validation errors out so they surface in-modal (the tray only
    // shows uploads that actually started).
    const accepted = []
    const newRejected = []
    for (const f of files) {
      const error = checkFile(f, purpose)
      if (error) {
        newRejected.push({ id: crypto.randomUUID(), name: f.name, error })
      } else {
        accepted.push(f)
      }
    }
    if (newRejected.length) setRejected((prev) => [...newRejected, ...prev])
    if (!accepted.length) return

    const results = await Promise.all(accepted.map((file) => startUpload(file, {
      createdBy: createdBy || null,
      assetPurpose: purpose,
      // mediaLib enforces null speakerRole on non-interview, but pass
      // explicitly anyway so the wire payload reads cleanly in logs.
      speakerRole: showSpeakerRole ? speakerRole : null,
    })))

    if (results.some((r) => r)) onUploaded?.()
  }

  function handleDrop(e) {
    e.preventDefault()
    setDragOver(false)
    handleFiles(e.dataTransfer.files)
  }

  return (
    <div>
      {/* Step 1 — what kind of asset is this. Purpose is the primary fork: it
          decides whether this upload feeds the interview-segmenter pipeline
          (and therefore generates edit briefs), gets tagged-only for search,
          or lands in the Brand Kit. Picking wrong = wrong downstream noise. */}
      <div className="mb-3 rounded-xl border bg-card p-4">
        <div className="flex items-center gap-2 mb-2.5">
          <span className="inline-flex items-center justify-center h-6 w-6 rounded-full bg-primary text-white text-xs font-semibold">1</span>
          <div>
            <div className="text-sm font-semibold">
              What kind of asset is this? <span className="text-destructive">*</span>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Picks the right pipeline. Only interview clips go to the editor&apos;s brief queue.
            </p>
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
          {PURPOSES.map((p) => {
            const Icon = p.icon
            const active = purpose === p.id
            return (
              <button
                type="button"
                key={p.id}
                onClick={() => setPurpose(p.id)}
                className={`text-left rounded-lg border-2 p-2.5 transition-colors ${
                  active
                    ? 'border-primary bg-primary/5'
                    : 'border-border hover:border-primary/40'
                }`}
              >
                <div className="flex items-center gap-2">
                  <Icon className={`h-4 w-4 ${active ? 'text-primary' : 'text-muted-foreground'}`} />
                  <span className={`text-sm font-medium ${active ? 'text-primary' : ''}`}>{p.label}</span>
                </div>
                <div className="text-[11px] text-muted-foreground mt-0.5 leading-snug">
                  {p.sublabel}
                </div>
              </button>
            )
          })}
        </div>
      </div>

      {/* Step 2 — speaker role, conditional on interview purpose. For B-roll,
          photos, and brand assets the question doesn't apply, so we hide it
          entirely instead of forcing a default that downstream prompts
          would treat as meaningful. */}
      {showSpeakerRole && (
        <div className="mb-3 rounded-xl border bg-card p-4">
          <div className="flex items-center gap-2 mb-2.5">
            <span className="inline-flex items-center justify-center h-6 w-6 rounded-full bg-primary text-white text-xs font-semibold">2</span>
            <div>
              <div className="text-sm font-semibold">
                Who&apos;s speaking in these clips? <span className="text-destructive">*</span>
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
      )}

      {/* Final step — drop zone. Step number adjusts based on whether the
          speaker-role step is showing, so the user always sees a continuous
          1 → 2 (→ 3) sequence. */}
      <div className="rounded-xl border bg-card p-4">
        <div className="flex items-center gap-2 mb-2.5">
          <span className="inline-flex items-center justify-center h-6 w-6 rounded-full bg-primary text-white text-xs font-semibold">
            {showSpeakerRole ? 3 : 2}
          </span>
          <div>
            <div className="text-sm font-semibold">Drop your files</div>
            <p className="text-[11px] text-muted-foreground">
              {dropZoneHint(purpose)}
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
          <p className="text-sm font-medium mb-0.5">
            {dropZoneHeadline(purpose)}
          </p>
          <p className="text-xs text-muted-foreground">
            Marked as <span className="font-medium">{purposeMeta.label.toLowerCase()}</span>
            {showSpeakerRole ? ` · ${labelForSpeaker(speakerRole)}` : ''}.
          </p>
        </div>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept={purposeMeta.accept}
        multiple
        className="hidden"
        onChange={(e) => handleFiles(e.target.files)}
      />

      {/* Pre-upload validation errors only. Successful uploads surface in
          the floating <UploadTray/>, which survives modal close. */}
      {rejected.length > 0 && (
        <div className="mt-3 space-y-1.5">
          {rejected.map((r) => (
            <div key={r.id} className="flex items-start gap-2 text-xs px-2.5 py-1.5 rounded-md bg-destructive/5 border border-destructive/20">
              <AlertCircle className="h-3.5 w-3.5 text-destructive shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <div className="truncate font-medium" title={r.name}>{r.name}</div>
                <div className="text-destructive">{r.error}</div>
              </div>
              <button
                type="button"
                className="text-[10px] text-muted-foreground hover:text-foreground"
                onClick={() => setRejected((prev) => prev.filter((x) => x.id !== r.id))}
              >
                Dismiss
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function labelForSpeaker(id) {
  const r = SPEAKER_ROLES.find((x) => x.id === id)
  return r ? r.label.toLowerCase() : id
}

function dropZoneHeadline(purpose) {
  if (purpose === 'photo')     return 'Drop photos here, or click to browse'
  if (purpose === 'interview') return 'Drop interview clips here, or click to browse'
  if (purpose === 'broll')     return 'Drop B-roll videos here, or click to browse'
  if (purpose === 'brand')     return 'Drop brand assets here, or click to browse'
  return 'Drop your files here, or click to browse'
}

function dropZoneHint(purpose) {
  if (purpose === 'photo')     return 'JPG, PNG, HEIC — max 50 MB per file.'
  if (purpose === 'brand')     return 'JPG, PNG, HEIC, MP4 — logos, headshots, icons. For SVG + role assignment use Brand Kit in Settings. Max 50 MB images, 2 GB videos.'
  return 'MP4, MOV, WebM — max 2 GB per file.'
}
