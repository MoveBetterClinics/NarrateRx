import { useEffect, useRef, useState } from 'react'
import { Loader2, AlertCircle, CheckCircle2, HardDrive, ExternalLink } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { apiFetch } from '@/lib/api'
import { toast } from '@/lib/toast'

// Google-Picker-backed import flow. Replaces the custom file browser (PR #685)
// after we moved to the drive.file OAuth scope (PR #687): with drive.file the
// access token can only download files the user has explicitly picked, so
// browsing has to happen inside Google's own UI (the Picker, which establishes
// the file→app relationship as a side effect of selection).
//
// Flow:
//   1. Modal opens → load Google's apis.google.com/js/api.js (cached after first
//      open) + gapi.load('picker', cb).
//   2. User clicks Browse Drive → fetch /api/integrations/drive/picker-token
//      to get { accessToken, developerKey, appId }, then construct + show
//      a Picker tuned to image/* + video/* mime types, multi-select on.
//   3. User picks files inside Google's UI → callback fires with selected
//      files → modal stays open showing the per-file Purpose pickers + import
//      button.
//   4. User clicks Import N files → POST /api/integrations/drive/import with
//      the picked IDs; the server downloads each (it can now, because Picker
//      registered them with our app), pushes through the standard pipeline,
//      and returns per-file status.

const PICKER_SCRIPT_SRC = 'https://apis.google.com/js/api.js'
const MAX_BATCH = 10

const PURPOSES = [
  { id: 'photo', label: 'Photo' },
  { id: 'interview', label: 'Interview clip' },
  { id: 'broll', label: 'B-roll video' },
  { id: 'brand', label: 'Brand asset' },
]
const SPEAKER_ROLES = [
  { id: 'clinician', label: 'Clinician' },
  { id: 'admin', label: 'Admin staff' },
  { id: 'patient_guest', label: 'Patient guest' },
]

function fmtSize(bytes) {
  if (!bytes) return ''
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

// Loads apis.google.com/js/api.js exactly once per page. Subsequent callers
// resolve immediately. We tag the script element so a second invocation
// reuses the in-flight promise rather than appending a duplicate script.
let _gapiLoadPromise = null
function loadGapi() {
  if (_gapiLoadPromise) return _gapiLoadPromise
  _gapiLoadPromise = new Promise((resolve, reject) => {
    if (typeof window === 'undefined') {
      reject(new Error('not in browser'))
      return
    }
    if (window.gapi) {
      resolve(window.gapi)
      return
    }
    const existing = document.querySelector(`script[data-narraterx-gapi="1"]`)
    if (existing) {
      existing.addEventListener('load', () => resolve(window.gapi))
      existing.addEventListener('error', () => reject(new Error('failed to load gapi script')))
      return
    }
    const s = document.createElement('script')
    s.src = PICKER_SCRIPT_SRC
    s.async = true
    s.defer = true
    s.dataset.narraterxGapi = '1'
    s.onload = () => resolve(window.gapi)
    s.onerror = () => reject(new Error('failed to load gapi script'))
    document.head.appendChild(s)
  })
  return _gapiLoadPromise
}

// Loads the Picker module (one-time per page). gapi itself is loaded by
// loadGapi(); this just calls gapi.load('picker', cb) which fetches the
// picker namespace on demand.
let _pickerLoadPromise = null
function loadPicker() {
  if (_pickerLoadPromise) return _pickerLoadPromise
  _pickerLoadPromise = loadGapi().then((gapi) =>
    new Promise((resolve, reject) => {
      gapi.load('picker', {
        callback: () => resolve(window.google?.picker || gapi.picker),
        onerror: () => reject(new Error('failed to load picker module')),
        timeout: 10_000,
        ontimeout: () => reject(new Error('timed out loading picker module')),
      })
    })
  )
  return _pickerLoadPromise
}

export default function DriveImportPicker({ onComplete, onClose }) {
  const [pickerReady, setPickerReady] = useState(false)
  const [pickerLoadError, setPickerLoadError] = useState(null)
  const [opening, setOpening] = useState(false)
  const [openError, setOpenError] = useState(null)
  const [selected, setSelected] = useState([]) // [{ id, name, mimeType, kind, size, thumbnailUrl }]
  const [purpose, setPurpose] = useState('photo')
  const [speakerRole, setSpeakerRole] = useState('clinician')
  const [importing, setImporting] = useState(false)
  const [perFileStatus, setPerFileStatus] = useState({}) // driveId → 'imported'|'duplicate'|'failed'|'pending'
  const pickerRef = useRef(null)

  useEffect(() => {
    let cancelled = false
    loadPicker()
      .then(() => { if (!cancelled) setPickerReady(true) })
      .catch((e) => { if (!cancelled) setPickerLoadError(e?.message || 'Failed to load Google Picker.') })
    return () => { cancelled = true }
  }, [])

  async function handleBrowse() {
    setOpening(true)
    setOpenError(null)
    try {
      const [google, config] = await Promise.all([
        loadPicker(),
        apiFetch('/api/integrations/drive/picker-token'),
      ])
      if (!config?.accessToken || !config?.developerKey || !config?.appId) {
        throw new Error('Picker config missing on server response')
      }

      // image/* + video/* across all the user's Drives. ViewId.DOCS_IMAGES_AND_VIDEOS
      // is Google's pre-built view that filters to media (this is the same
      // view Gmail uses for its "Insert photo" flow).
      const imageView = new google.DocsView(google.ViewId.DOCS_IMAGES)
        .setIncludeFolders(true)
        .setSelectFolderEnabled(false)
        .setOwnedByMe(false)
        .setMode(google.DocsViewMode.GRID)
      const videoView = new google.DocsView(google.ViewId.DOCS_VIDEOS)
        .setIncludeFolders(true)
        .setSelectFolderEnabled(false)
        .setOwnedByMe(false)
        .setMode(google.DocsViewMode.GRID)
      const sharedView = new google.DocsView(google.ViewId.DOCS_IMAGES_AND_VIDEOS)
        .setIncludeFolders(true)
        .setSelectFolderEnabled(false)
        .setOwnedByMe(false)
        .setMode(google.DocsViewMode.GRID)
      const sharedDrivesView = new google.DocsView(google.ViewId.DOCS_IMAGES_AND_VIDEOS)
        .setIncludeFolders(true)
        .setSelectFolderEnabled(false)
        .setEnableDrives(true)
        .setMode(google.DocsViewMode.GRID)

      const picker = new google.PickerBuilder()
        .enableFeature(google.Feature.MULTISELECT_ENABLED)
        .enableFeature(google.Feature.SUPPORT_DRIVES)
        .setOAuthToken(config.accessToken)
        .setDeveloperKey(config.developerKey)
        .setAppId(config.appId)
        .setTitle('Pick photos and videos to import into NarrateRx')
        .addView(sharedView)
        .addView(imageView)
        .addView(videoView)
        .addView(sharedDrivesView)
        .setCallback((data) => {
          if (data.action === google.Action.PICKED) {
            const docs = Array.isArray(data.docs) ? data.docs : []
            if (docs.length > MAX_BATCH) {
              toast.error(`Pick up to ${MAX_BATCH} files at a time. Showing the first ${MAX_BATCH}.`)
            }
            const trimmed = docs.slice(0, MAX_BATCH).map((d) => {
              const mime = d.mimeType || ''
              return {
                id: d.id,
                name: d.name,
                mimeType: mime,
                size: d.sizeBytes ? Number(d.sizeBytes) : null,
                kind: mime.startsWith('video/') ? 'video' : 'image',
                thumbnailUrl: d.thumbnails && d.thumbnails[0]?.url ? d.thumbnails[0].url : null,
              }
            })
            setSelected(trimmed)
            setPerFileStatus({})
            // Default the batch purpose to whatever the majority kind is.
            const videos = trimmed.filter((t) => t.kind === 'video').length
            const images = trimmed.length - videos
            if (videos > images) setPurpose('interview')
            else setPurpose('photo')
          }
          // CANCEL / LOADED / etc. fall through — no state change.
        })
        .build()
      pickerRef.current = picker
      picker.setVisible(true)
    } catch (err) {
      if (err?.status === 412) {
        setOpenError('Reconnect required — Google revoked access. Open Settings → Integrations to reconnect.')
      } else if (err?.status === 503) {
        setOpenError('Google Picker isn’t configured on this deployment yet. Ask the admin to set GOOGLE_DRIVE_API_KEY and GOOGLE_DRIVE_APP_ID.')
      } else if (err?.status === 403) {
        setOpenError('Only authenticated workspace members can use Drive import.')
      } else {
        setOpenError(err?.message || 'Couldn’t open Google Picker.')
      }
    } finally {
      setOpening(false)
    }
  }

  function clearSelection() {
    setSelected([])
    setPerFileStatus({})
  }

  async function handleImport() {
    if (!selected.length) return
    setImporting(true)
    const pending = {}
    for (const f of selected) pending[f.id] = 'pending'
    setPerFileStatus(pending)

    try {
      const payload = {
        items: selected.map((f) => ({
          id: f.id,
          assetPurpose: purpose,
          speakerRole: purpose === 'interview' ? speakerRole : null,
        })),
      }
      const data = await apiFetch('/api/integrations/drive/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const next = { ...pending }
      let imported = 0, duplicates = 0, failed = 0
      for (const r of data?.results || []) {
        if (r.status === 'imported') { next[r.driveId] = 'imported'; imported++ }
        else if (r.status === 'duplicate') { next[r.driveId] = 'duplicate'; duplicates++ }
        else { next[r.driveId] = `failed:${r.reason || ''}`; failed++ }
      }
      setPerFileStatus(next)

      if (imported) toast.success(`Imported ${imported} file${imported === 1 ? '' : 's'} from Drive.`)
      if (duplicates) toast.info(`${duplicates} already in Library — skipped.`)
      if (failed) toast.error(`${failed} failed to import. Hover the row for details.`)
      onComplete?.()
    } catch (err) {
      if (err?.status === 412) {
        toast.error('Reconnect required — Google revoked access. Open Settings → Integrations to reconnect.')
      } else {
        toast.error(err?.message || 'Import failed.')
      }
      const next = { ...perFileStatus }
      for (const f of selected) {
        if (next[f.id] === 'pending' || !next[f.id]) next[f.id] = `failed:${err?.message || 'request failed'}`
      }
      setPerFileStatus(next)
    } finally {
      setImporting(false)
    }
  }

  const hasSelection = selected.length > 0
  const canBrowse = pickerReady && !opening && !importing

  return (
    <div className="flex flex-col h-full">
      {/* Top zone — either intro/error or thumbnail strip after selection */}
      <div className="flex-1 overflow-y-auto py-2 min-h-[260px]">
        {pickerLoadError && (
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 flex items-start gap-2 mb-3">
            <AlertCircle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
            <div className="text-sm text-destructive flex-1">{pickerLoadError}</div>
          </div>
        )}
        {openError && (
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 flex items-start gap-2 mb-3">
            <AlertCircle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
            <div className="text-sm text-destructive flex-1">{openError}</div>
          </div>
        )}

        {!hasSelection && (
          <div className="text-center py-8 px-4">
            <HardDrive className="h-10 w-10 text-muted-foreground/40 mx-auto mb-3" />
            <p className="text-sm font-medium mb-1.5">Pick photos and videos from Drive</p>
            <p className="text-xs text-muted-foreground mb-4 max-w-md mx-auto leading-relaxed">
              Google’s file picker opens in a window. Pick up to {MAX_BATCH} files; only the files you pick are shared with NarrateRx — we can’t see the rest of your Drive.
            </p>
            <Button onClick={handleBrowse} disabled={!canBrowse}>
              {opening ? (
                <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Opening Google Picker…</>
              ) : !pickerReady ? (
                <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Loading Picker…</>
              ) : (
                <><HardDrive className="h-4 w-4 mr-2" /> Browse Drive</>
              )}
            </Button>
          </div>
        )}

        {hasSelection && (
          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-3xs uppercase tracking-wide text-muted-foreground font-semibold">
                {selected.length} file{selected.length === 1 ? '' : 's'} ready to import
              </p>
              <button
                type="button"
                className="text-2xs text-primary hover:underline disabled:opacity-50 disabled:no-underline"
                onClick={handleBrowse}
                disabled={!canBrowse}
              >
                Pick more…
              </button>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
              {selected.map((f) => {
                const status = perFileStatus[f.id]
                const failed = status && String(status).startsWith('failed')
                return (
                  <div
                    key={f.id}
                    className="relative rounded-lg border-2 border-primary/30 overflow-hidden"
                    title={failed ? String(status).slice(7) : f.name}
                  >
                    <div className="aspect-[4/3] bg-muted flex items-center justify-center overflow-hidden">
                      {f.thumbnailUrl ? (
                        <img
                          src={f.thumbnailUrl}
                          alt=""
                          loading="lazy"
                          className="w-full h-full object-cover"
                          referrerPolicy="no-referrer"
                        />
                      ) : (
                        <HardDrive className="h-7 w-7 text-muted-foreground/50" />
                      )}
                    </div>
                    <div className="px-2 py-1.5 text-xs">
                      <div className="font-medium truncate" title={f.name}>{f.name}</div>
                      <div className="text-2xs text-muted-foreground">
                        {f.kind === 'video' ? 'Video' : 'Image'}{f.size ? ` · ${fmtSize(f.size)}` : ''}
                      </div>
                    </div>
                    {status === 'imported' && (
                      <div className="absolute inset-x-0 bottom-0 bg-success/90 text-white text-3xs px-2 py-1 flex items-center gap-1 font-medium">
                        <CheckCircle2 className="h-3 w-3" /> Imported
                      </div>
                    )}
                    {status === 'duplicate' && (
                      <div className="absolute inset-x-0 bottom-0 bg-muted/90 text-foreground text-3xs px-2 py-1 font-medium">
                        Already in Library
                      </div>
                    )}
                    {failed && (
                      <div className="absolute inset-x-0 bottom-0 bg-destructive/90 text-white text-3xs px-2 py-1 font-medium truncate" title={String(status).slice(7)}>
                        Failed
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>

      {/* Footer — batch settings + actions, only shown when something's picked */}
      <div className="border-t pt-3 space-y-2.5">
        {hasSelection && (
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label className="text-3xs uppercase tracking-wide text-muted-foreground font-semibold block mb-1">Purpose for batch</label>
              <select
                value={purpose}
                onChange={(e) => setPurpose(e.target.value)}
                className="h-7 px-2 rounded border bg-card text-xs"
              >
                {PURPOSES.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
              </select>
            </div>
            {purpose === 'interview' && (
              <div>
                <label className="text-3xs uppercase tracking-wide text-muted-foreground font-semibold block mb-1">Speaker role</label>
                <select
                  value={speakerRole}
                  onChange={(e) => setSpeakerRole(e.target.value)}
                  className="h-7 px-2 rounded border bg-card text-xs"
                >
                  {SPEAKER_ROLES.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
                </select>
              </div>
            )}
            <a
              href="https://drive.google.com"
              target="_blank"
              rel="noopener noreferrer"
              className="ml-auto text-2xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
            >
              Open Drive <ExternalLink className="h-3 w-3" />
            </a>
          </div>
        )}
        <div className="flex items-center gap-2 justify-end">
          {hasSelection && (
            <Button variant="ghost" size="sm" onClick={clearSelection} disabled={importing}>
              Clear
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={onClose} disabled={importing}>
            Close
          </Button>
          {hasSelection && (
            <Button
              size="sm"
              disabled={importing || !selected.length}
              onClick={handleImport}
            >
              {importing
                ? <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> Importing {selected.length}…</>
                : <>Import {selected.length} file{selected.length === 1 ? '' : 's'}</>}
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}
