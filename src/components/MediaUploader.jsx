import { useRef, useState } from 'react'
import { Upload, Loader2, AlertCircle, CheckCircle2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { uploadMedia } from '@/lib/mediaLib'

const SPEAKER_ROLES = [
  { id: 'clinician',     label: 'Clinician (in clinic, treating patient)' },
  { id: 'admin',         label: 'Admin staff (operations / business)' },
  { id: 'patient_guest', label: 'Patient guest (consent required)' },
]

// Drag-drop / click uploader for the Media Hub.
// Multiple files supported; uploads run in parallel.
export default function MediaUploader({ onUploaded, createdBy }) {
  const inputRef = useRef(null)
  const [dragOver, setDragOver]    = useState(false)
  const [uploads, setUploads]      = useState([])  // [{ id, name, status:'uploading'|'done'|'error', error? }]
  const [speakerRole, setSpeakerRole] = useState('clinician')

  async function handleFiles(fileList) {
    const files = Array.from(fileList || [])
    if (!files.length) return

    const newRows = files.map((f) => ({
      id: crypto.randomUUID(),
      name: f.name,
      status: 'uploading',
    }))
    setUploads((prev) => [...newRows, ...prev])

    await Promise.all(files.map(async (file, i) => {
      const rowId = newRows[i].id
      try {
        await uploadMedia(file, { createdBy: createdBy || null, speakerRole })
        setUploads((prev) => prev.map((r) => r.id === rowId ? { ...r, status: 'done' } : r))
      } catch (e) {
        setUploads((prev) => prev.map((r) => r.id === rowId ? { ...r, status: 'error', error: e.message } : r))
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
      {/* Speaker role — sets the segmenter framing. Default 'clinician'. */}
      <div className="mb-2 flex items-center gap-2">
        <label className="text-xs font-medium text-muted-foreground">Who's speaking in these clips?</label>
        <select
          value={speakerRole}
          onChange={(e) => setSpeakerRole(e.target.value)}
          className="text-[11px] h-7 px-2 rounded-md border border-border bg-background text-foreground"
        >
          {SPEAKER_ROLES.map((r) => (
            <option key={r.id} value={r.id}>{r.label}</option>
          ))}
        </select>
        {speakerRole === 'patient_guest' && (
          <span className="text-[11px] text-amber-600">⚠ Verify written consent before uploading.</span>
        )}
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
        <p className="text-xs text-muted-foreground">JPG, PNG, HEIC, MP4, MOV — uploads go to your private library</p>
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
              {r.status === 'uploading' && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
              {r.status === 'done'      && <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />}
              {r.status === 'error'     && <AlertCircle  className="h-3.5 w-3.5 text-destructive" />}
              <span className="truncate flex-1">{r.name}</span>
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
