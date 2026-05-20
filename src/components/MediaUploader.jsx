import { useEffect, useRef, useState } from 'react'
import {
  Upload, AlertCircle,
  Stethoscope, Briefcase, UserCircle, AlertTriangle,
  Mic, Film, Image as ImageIcon, Sparkles,
  Folder, CheckCircle2,
} from 'lucide-react'
import { useUploadProgress } from '@/lib/UploadProgressContext'
import { listCollections } from '@/lib/collectionsLib'
import { fetchClinicians } from '@/lib/api'

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

// macOS Photos drag-drop substitutes rendered preview JPEGs for the source
// video at the OS pasteboard boundary. We can't get the .MOV back from the
// drop event, but we can spot the substitution and explain it to the user.
// Heuristic: iCloud Photos' internal-UUID + suffix pattern on the filename,
// OR (for drops) an image landing in a video-only purpose.
const PHOTOS_PREVIEW_FILENAME_RE = /^[A-F0-9]{8}-[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{12}_\d+_\d+_[a-z]\.jpe?g$/i

function looksLikeMacPhotosPreview(file, purpose, { fromDrop } = {}) {
  if (PHOTOS_PREVIEW_FILENAME_RE.test(file.name || '')) return true
  const kind = kindFromType(file.type || '')
  const purposeWantsVideo = purpose === 'interview' || purpose === 'broll'
  return Boolean(fromDrop && kind === 'image' && purposeWantsVideo)
}

const PHOTOS_PREVIEW_MESSAGE =
  'macOS Photos sent us a preview frame, not the video. Export the original to Finder first (Photos → File → Export → Export Unmodified Original), or use "click to browse" below instead of dragging — both bypass this.'

function checkFile(file, purpose, opts = {}) {
  const t = file.type || ''
  const kind = kindFromType(t)
  if (t && !kind) {
    return `Unsupported file type (${t}). Only images and videos are accepted.`
  }
  if (kind && !acceptsKind(purpose, kind)) {
    if (looksLikeMacPhotosPreview(file, purpose, opts)) {
      return PHOTOS_PREVIEW_MESSAGE
    }
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

// Probe a video file's duration without a network round-trip — used in the
// smart-preview tray so the publisher sees clip length before upload. Resolves
// to null on any failure (codec issues, autoplay restrictions) so the preview
// degrades gracefully.
function probeVideoDurationSeconds(file) {
  return new Promise((resolve) => {
    try {
      const url = URL.createObjectURL(file)
      const v = document.createElement('video')
      v.preload = 'metadata'
      v.muted = true
      const cleanup = () => { URL.revokeObjectURL(url); v.remove() }
      v.onloadedmetadata = () => { const d = v.duration; cleanup(); resolve(Number.isFinite(d) ? d : null) }
      v.onerror = () => { cleanup(); resolve(null) }
      v.src = url
    } catch { resolve(null) }
  })
}

function fmtDuration(secs) {
  if (!secs || !Number.isFinite(secs)) return ''
  const m = Math.floor(secs / 60)
  const s = Math.floor(secs % 60).toString().padStart(2, '0')
  return `${m}:${s}`
}

function fmtSize(bytes) {
  if (!bytes) return ''
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

// Drag-drop / click uploader for the Library.
// Multiple files supported; uploads run in parallel.
export default function MediaUploader({ onUploaded, createdBy }) {
  const inputRef = useRef(null)
  const [dragOver, setDragOver]    = useState(false)
  // Pre-upload validation errors only — actual progress lives in the
  // app-wide UploadProgressContext and is rendered by <UploadTray/>.
  const [rejected, setRejected]    = useState([])
  const [purpose, setPurpose]      = useState('interview')
  const [speakerRole, setSpeakerRole] = useState('clinician')
  const [collectionId, setCollectionId] = useState('')
  const [collections, setCollections] = useState([])
  const [clinicianId, setClinicianId] = useState('')
  const [clinicians, setClinicians] = useState([])
  // Smart-preview tray — files pending upload, with detected duration + any
  // purpose mismatch flags. Cleared after a successful upload kick-off.
  const [pending, setPending] = useState([])
  const { startUpload } = useUploadProgress()

  const purposeMeta = PURPOSES.find((p) => p.id === purpose) || PURPOSES[0]
  const showSpeakerRole = purpose === 'interview'
  // Clinician picker shows for non-interview uploads (broll/photo/brand) and
  // for interview uploads where the speaker IS the clinician. Admin-staff and
  // patient-guest interviews don't get the picker — the clip isn't "of" a
  // clinician in those cases, so attribution would be misleading.
  const showClinicianPicker = ((!showSpeakerRole) || speakerRole === 'clinician') && clinicians.length > 0
  // Build a continuous 1-N step numbering regardless of which optional
  // sections actually render. Purpose is always step 1; the counter starts
  // at 2 so the next-shown section gets 2. DOM order is: purpose → speaker
  // role → clinician → collection → drop zone.
  let stepCounter = 2
  const stepSpeakerRole = showSpeakerRole ? stepCounter++ : null
  const stepClinician = showClinicianPicker ? stepCounter++ : null
  const stepCollection = collections.length > 0 ? stepCounter++ : null
  const stepDrop = stepCounter

  // Fetch active collections and clinicians once on mount.
  useEffect(() => {
    let cancelled = false
    listCollections({ status: 'active', limit: 100 })
      .then((rows) => { if (!cancelled) setCollections(Array.isArray(rows) ? rows : []) })
      .catch(() => { if (!cancelled) setCollections([]) })
    fetchClinicians()
      .then((rows) => { if (!cancelled) setClinicians(Array.isArray(rows) ? rows : []) })
      .catch(() => { if (!cancelled) setClinicians([]) })
    return () => { cancelled = true }
  }, [])

  async function buildPendingEntry(file) {
    const t = file.type || ''
    const kind = kindFromType(t)
    const mismatch = kind && !acceptsKind(purpose, kind)
    const duration = kind === 'video' ? await probeVideoDurationSeconds(file) : null
    return {
      id: crypto.randomUUID(),
      file,
      name: file.name,
      size: file.size,
      kind,
      duration,
      mismatch,
    }
  }

  async function handleFiles(fileList, opts = {}) {
    const files = Array.from(fileList || [])
    if (!files.length) return

    // Split validation errors out so they surface in-modal (the tray only
    // shows uploads that actually started).
    const accepted = []
    const newRejected = []
    for (const f of files) {
      const error = checkFile(f, purpose, opts)
      if (error) {
        newRejected.push({ id: crypto.randomUUID(), name: f.name, error })
      } else {
        accepted.push(f)
      }
    }
    if (newRejected.length) setRejected((prev) => [...newRejected, ...prev])
    if (!accepted.length) return

    // Build preview entries first (probes video durations) so the tray
    // populates before uploads kick off. Probes run in parallel.
    const entries = await Promise.all(accepted.map(buildPendingEntry))
    setPending(entries)

    const results = await Promise.all(accepted.map((file) => startUpload(file, {
      createdBy: createdBy || null,
      assetPurpose: purpose,
      // mediaLib enforces null speakerRole on non-interview, but pass
      // explicitly anyway so the wire payload reads cleanly in logs.
      speakerRole: showSpeakerRole ? speakerRole : null,
      // Optional — server verifies workspace scope before linking.
      collectionId: collectionId || null,
      clinicianId: showClinicianPicker ? clinicianId || null : null,
    })))

    if (results.some((r) => r)) onUploaded?.()
  }

  function handleDrop(e) {
    e.preventDefault()
    setDragOver(false)
    handleFiles(e.dataTransfer.files, { fromDrop: true })
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
            <p className="text-2xs text-muted-foreground">
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
                <div className="text-2xs text-muted-foreground mt-0.5 leading-snug">
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
            <span className="inline-flex items-center justify-center h-6 w-6 rounded-full bg-primary text-white text-xs font-semibold">{stepSpeakerRole}</span>
            <div>
              <div className="text-sm font-semibold">
                Who&apos;s speaking in these clips? <span className="text-destructive">*</span>
              </div>
              <p className="text-2xs text-muted-foreground">
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
                  <div className="text-2xs text-muted-foreground mt-0.5 leading-snug">
                    {r.sublabel}
                  </div>
                </button>
              )
            })}
          </div>
          {speakerRole === 'patient_guest' && (
            <div className="mt-2.5 flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 dark:bg-warning/15 p-2.5">
              <AlertTriangle className="h-4 w-4 text-warning shrink-0 mt-0.5" />
              <p className="text-xs text-warning">
                Verify written consent from the patient before uploading. Patient-guest content cannot be published without it.
              </p>
            </div>
          )}
        </div>
      )}

      {/* Clinician picker — optional. Shows for non-interview uploads
          (broll/photo/brand) and for interview clips where the speaker is the
          clinician. Hidden for admin-staff and patient-guest interviews where
          clinician attribution would be misleading. Links the asset to a
          specific clinician so Library filters and staff attribution work. */}
      {showClinicianPicker && (
        <div className="mb-3 rounded-xl border bg-card p-4">
          <div className="flex items-center gap-2 mb-2.5">
            <span className="inline-flex items-center justify-center h-6 w-6 rounded-full bg-primary text-white text-xs font-semibold">
              {stepClinician}
            </span>
            <div>
              <div className="text-sm font-semibold">
                Who&apos;s in this?
                <span className="ml-1.5 inline-block text-xs px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground font-medium uppercase tracking-wide">
                  Optional
                </span>
              </div>
              <p className="text-xs text-muted-foreground">
                Tag a clinician so this asset shows up on their profile and in searches.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={() => setClinicianId('')}
              className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                !clinicianId
                  ? 'bg-primary text-white border-primary'
                  : 'bg-muted text-muted-foreground border-border hover:border-primary/50'
              }`}
            >
              — Not sure / multiple
            </button>
            {clinicians.map((c) => (
              <button
                type="button"
                key={c.id}
                onClick={() => setClinicianId(c.id === clinicianId ? '' : c.id)}
                className={`inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full border transition-colors ${
                  clinicianId === c.id
                    ? 'bg-primary text-white border-primary'
                    : 'bg-muted text-muted-foreground border-border hover:border-primary/50'
                }`}
              >
                <span className="inline-flex h-4 w-4 rounded-full bg-current/20 items-center justify-center text-3xs font-semibold shrink-0">
                  {c.name?.[0] || '?'}
                </span>
                {c.name}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Collection picker — optional. Pre-assigns uploaded assets to a
          campaign / series / session collection in one shot, replacing the
          two-step "upload, then Select → Add to collection" flow for the
          campaign-style cadence. */}
      {collections.length > 0 && (
        <div className="mb-3 rounded-xl border bg-card p-4">
          <div className="flex items-center gap-2 mb-2.5">
            <span className="inline-flex items-center justify-center h-6 w-6 rounded-full bg-primary text-white text-xs font-semibold">
              {stepCollection}
            </span>
            <div>
              <div className="text-sm font-semibold">
                Add to a collection?
                <span className="ml-1.5 inline-block text-3xs px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground font-medium uppercase tracking-wide">
                  Optional
                </span>
              </div>
              <p className="text-2xs text-muted-foreground">
                Group with related uploads now. You can always add to one later via Select &gt; Add to collection.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={() => setCollectionId('')}
              className={`text-2xs px-2.5 py-1 rounded-full border transition-colors ${
                !collectionId
                  ? 'bg-primary text-white border-primary'
                  : 'bg-muted text-muted-foreground border-border hover:border-primary/50'
              }`}
            >
              — No collection
            </button>
            {collections.map((c) => (
              <button
                type="button"
                key={c.id}
                onClick={() => setCollectionId(c.id === collectionId ? '' : c.id)}
                title={c.description || c.name}
                className={`inline-flex items-center gap-1 text-2xs px-2.5 py-1 rounded-full border transition-colors ${
                  collectionId === c.id
                    ? 'bg-primary text-white border-primary'
                    : 'bg-muted text-muted-foreground border-border hover:border-primary/50'
              }`}
              >
                <Folder className="h-3 w-3" />
                <span className="truncate max-w-[200px]">{c.name}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Final step — drop zone. Step number walks based on which optional
          steps showed (speaker role, clinician, collection). */}
      <div className="rounded-xl border bg-card p-4">
        <div className="flex items-center gap-2 mb-2.5">
          <span className="inline-flex items-center justify-center h-6 w-6 rounded-full bg-primary text-white text-xs font-semibold">
            {stepDrop}
          </span>
          <div>
            <div className="text-sm font-semibold">Drop your files</div>
            <p className="text-2xs text-muted-foreground">
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
          {(purpose === 'interview' || purpose === 'broll') && (
            <p className="text-2xs text-muted-foreground/80 mb-1">
              Dragging from macOS Photos? Use &ldquo;click to browse&rdquo; — Photos&apos; drag handler sends preview frames, not the source video.
            </p>
          )}
          <p className="text-xs text-muted-foreground">
            Marked as <span className="font-medium">{purposeMeta.label.toLowerCase()}</span>
            {showSpeakerRole ? ` · ${labelForSpeaker(speakerRole)}` : ''}
            {collectionId && collections.find((c) => c.id === collectionId)
              ? ` · ${collections.find((c) => c.id === collectionId).name}`
              : ''}
            {clinicianId && clinicians.find((c) => c.id === clinicianId)
              ? ` · ${clinicians.find((c) => c.id === clinicianId).name}`
              : ''}.
          </p>
        </div>

        {/* Smart-preview tray — populated after files drop. Shows size +
            duration (videos) and any purpose mismatch so the publisher sees
            what's about to go up before the progress tray takes over. */}
        {pending.length > 0 && (
          <div className="mt-3 rounded-lg border border-success/30 bg-success/10 p-3">
            <div className="flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-wide text-success mb-2">
              <CheckCircle2 className="h-3.5 w-3.5" />
              {pending.length} file{pending.length === 1 ? '' : 's'} detected · uploading now
            </div>
            <div className="space-y-1.5">
              {pending.map((p) => (
                <div key={p.id} className="flex items-center gap-2.5 bg-white rounded-md px-2.5 py-1.5 text-xs">
                  <span className="w-8 h-8 rounded bg-muted flex items-center justify-center text-base shrink-0">
                    {p.kind === 'video' ? '▶' : p.kind === 'image' ? '📷' : '?'}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate" title={p.name}>{p.name}</div>
                    <div className="text-muted-foreground text-2xs">
                      {p.kind || 'unknown'} · {fmtSize(p.size)}
                      {p.duration ? ` · ${fmtDuration(p.duration)}` : ''}
                    </div>
                  </div>
                  {p.mismatch ? (
                    <span className="shrink-0 text-3xs px-1.5 py-0.5 rounded bg-warning/15 text-warning font-medium">
                      type mismatch
                    </span>
                  ) : (
                    <span className="shrink-0 text-3xs px-1.5 py-0.5 rounded bg-success/15 text-success font-medium">
                      {purposeMeta.label.toLowerCase()}
                    </span>
                  )}
                </div>
              ))}
            </div>
            <p className="mt-2 text-3xs text-muted-foreground">
              AI tags every upload for search. Interview clips also feed the editor brief queue.
            </p>
          </div>
        )}
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
                className="text-3xs text-muted-foreground hover:text-foreground"
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
