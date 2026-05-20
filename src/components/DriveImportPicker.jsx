import { useEffect, useRef, useState } from 'react'
import {
  Search, Loader2, Folder, ChevronRight, Image as ImageIcon, Film, X,
  ArrowLeft, AlertCircle, CheckCircle2, RefreshCcw, Home,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { apiFetch } from '@/lib/api'
import { toast } from '@/lib/toast'

// Folder/file browser that reads from /api/integrations/drive/list and writes
// to /api/integrations/drive/import. Used inside the Library's
// "Import from Drive" modal. Keeps state internal — parent only needs to know
// when an import completes (so the grid can refresh).
//
// UI structure:
//   ┌────────────────────────────────────┐
//   │ Breadcrumb           [Search box]  │
//   ├────────────────────────────────────┤
//   │ Folder1   Folder2   …              │
//   │ File1✓    File2     File3✓   …    │
//   │ [Load more]                        │
//   ├────────────────────────────────────┤
//   │ Purpose: [Photo▾] Speaker: [Clin▾]│
//   │ N selected  [Cancel]  [Import N]   │
//   └────────────────────────────────────┘

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

const MAX_BATCH = 10

export default function DriveImportPicker({ onComplete, onClose }) {
  // Navigation stack — each entry is { id, name }. The first entry is the
  // virtual "My Drive" root; clicking a folder pushes; breadcrumb back pops.
  const [stack, setStack] = useState([{ id: 'root', name: 'My Drive' }])
  const [items, setItems] = useState([])
  const [pageToken, setPageToken] = useState(null)
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState(null)
  const [query, setQuery] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const [selected, setSelected] = useState({}) // driveId → metadata
  const [purpose, setPurpose] = useState('photo')
  const [speakerRole, setSpeakerRole] = useState('clinician')
  const [importing, setImporting] = useState(false)
  const [perFileStatus, setPerFileStatus] = useState({}) // driveId → 'imported'|'duplicate'|'failed'|'pending'
  const debounceRef = useRef(null)

  const currentFolderId = stack[stack.length - 1]?.id || 'root'
  const inSearchMode = Boolean(debouncedQuery.trim())
  const selectedCount = Object.keys(selected).length

  useEffect(() => {
    clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => setDebouncedQuery(query), 350)
    return () => clearTimeout(debounceRef.current)
  }, [query])

  async function load({ append = false, folderId, pageToken: nextToken, queryStr } = {}) {
    setLoading(true)
    setLoadError(null)
    try {
      const params = new URLSearchParams()
      if (queryStr) params.set('q', queryStr)
      else params.set('folder', folderId || currentFolderId)
      if (nextToken) params.set('pageToken', nextToken)
      const data = await apiFetch(`/api/integrations/drive/list?${params}`)
      setItems((prev) => (append ? [...prev, ...(data?.items || [])] : (data?.items || [])))
      setPageToken(data?.nextPageToken || null)
    } catch (err) {
      setItems(append ? items : [])
      setPageToken(null)
      if (err?.status === 412) {
        setLoadError('Reconnect required — Google revoked access. Go to Settings → Integrations to reconnect.')
      } else if (err?.status === 401) {
        setLoadError('Your session expired — reload the page.')
      } else if (err?.status === 403) {
        setLoadError('You don’t have access to browse Drive in this workspace.')
      } else if (err?.status === 503) {
        setLoadError('Google Drive isn’t connected yet. Go to Settings → Integrations to connect.')
      } else {
        setLoadError(err?.message || 'Failed to load Drive.')
      }
    } finally {
      setLoading(false)
    }
  }

  // Reload whenever folder OR search query changes. Selections persist across
  // navigation so users can pick from multiple folders in one batch.
  useEffect(() => {
    load({ folderId: currentFolderId, queryStr: debouncedQuery })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentFolderId, debouncedQuery])

  function navigateInto(folder) {
    setStack((prev) => [...prev, folder])
    setQuery('')
    setDebouncedQuery('')
  }
  function navigateTo(index) {
    setStack((prev) => prev.slice(0, index + 1))
    setQuery('')
    setDebouncedQuery('')
  }
  function navigateUp() {
    if (stack.length > 1) setStack((prev) => prev.slice(0, -1))
  }

  function toggleSelect(file) {
    setSelected((prev) => {
      const next = { ...prev }
      if (next[file.id]) {
        delete next[file.id]
      } else {
        if (Object.keys(next).length >= MAX_BATCH) {
          toast.error(`Pick up to ${MAX_BATCH} files at a time.`)
          return prev
        }
        next[file.id] = file
      }
      return next
    })
  }

  function clearSelection() {
    setSelected({})
    setPerFileStatus({})
  }

  async function handleImport() {
    const list = Object.values(selected)
    if (!list.length) return
    setImporting(true)
    const pending = {}
    for (const f of list) pending[f.id] = 'pending'
    setPerFileStatus(pending)

    try {
      const payload = {
        items: list.map((f) => ({
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
      // Mark every pending row as failed so the user sees what didn't go.
      const next = { ...perFileStatus }
      for (const f of list) {
        if (next[f.id] === 'pending' || !next[f.id]) next[f.id] = `failed:${err?.message || 'request failed'}`
      }
      setPerFileStatus(next)
    } finally {
      setImporting(false)
    }
  }

  const folders = items.filter((i) => i.kind === 'folder')
  const files = items.filter((i) => i.kind !== 'folder')

  return (
    <div className="flex flex-col h-full">
      {/* Navigation header */}
      <div className="flex items-center justify-between gap-2 pb-2 border-b">
        <div className="flex items-center gap-1.5 text-sm min-w-0 flex-1">
          {stack.length > 1 && (
            <Button variant="ghost" size="sm" className="h-7 px-1.5" onClick={navigateUp}>
              <ArrowLeft className="h-3.5 w-3.5" />
            </Button>
          )}
          <Home className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          <div className="flex items-center gap-1 min-w-0 overflow-x-auto">
            {stack.map((entry, idx) => (
              <div key={`${entry.id}-${idx}`} className="flex items-center gap-1 shrink-0">
                {idx > 0 && <ChevronRight className="h-3 w-3 text-muted-foreground" />}
                <button
                  className={`text-xs hover:underline truncate max-w-[160px] ${
                    idx === stack.length - 1 ? 'font-medium text-foreground' : 'text-muted-foreground'
                  }`}
                  onClick={() => navigateTo(idx)}
                >
                  {entry.name}
                </button>
              </div>
            ))}
          </div>
        </div>
        <div className="relative w-56">
          <Search className="absolute left-2 top-1.5 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search Drive…"
            className="pl-7 pr-7 h-7 text-xs"
          />
          {query && (
            <button
              onClick={() => setQuery('')}
              className="absolute right-2 top-1.5 text-muted-foreground hover:text-foreground"
              aria-label="Clear search"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Item list */}
      <div className="flex-1 overflow-y-auto py-3 min-h-[280px]">
        {loadError && (
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 flex items-start gap-2 mb-3">
            <AlertCircle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
            <div className="flex-1 text-sm text-destructive">{loadError}</div>
            <Button variant="ghost" size="sm" className="h-6 px-2" onClick={() => load({ folderId: currentFolderId, queryStr: debouncedQuery })}>
              <RefreshCcw className="h-3 w-3 mr-1" /> Retry
            </Button>
          </div>
        )}

        {loading && items.length === 0 && (
          <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin mr-2" /> Loading Drive…
          </div>
        )}

        {!loading && !loadError && items.length === 0 && (
          <div className="text-center py-12 text-sm text-muted-foreground">
            {inSearchMode ? `No matches for “${debouncedQuery}”.` : 'This folder has no images or videos.'}
          </div>
        )}

        {folders.length > 0 && !inSearchMode && (
          <div className="mb-3">
            <p className="text-3xs uppercase tracking-wide text-muted-foreground font-semibold mb-1.5">Folders</p>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
              {folders.map((f) => (
                <button
                  key={f.id}
                  onClick={() => navigateInto(f)}
                  className="flex items-center gap-2 px-2.5 py-2 rounded-lg border border-border hover:border-primary/50 hover:bg-accent/30 text-left text-sm transition-colors"
                >
                  <Folder className="h-4 w-4 text-primary shrink-0" />
                  <span className="truncate">{f.name}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {files.length > 0 && (
          <div>
            <p className="text-3xs uppercase tracking-wide text-muted-foreground font-semibold mb-1.5">
              {inSearchMode ? 'Results' : 'Files'} <span className="text-muted-foreground/60">· click to select</span>
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
              {files.map((f) => {
                const isSelected = Boolean(selected[f.id])
                const status = perFileStatus[f.id]
                const failed = status && String(status).startsWith('failed')
                return (
                  <button
                    key={f.id}
                    onClick={() => toggleSelect(f)}
                    className={`relative text-left rounded-lg border-2 overflow-hidden transition-colors ${
                      isSelected
                        ? 'border-primary ring-1 ring-primary/40'
                        : 'border-border hover:border-primary/40'
                    }`}
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
                      ) : f.kind === 'video' ? (
                        <Film className="h-8 w-8 text-muted-foreground/60" />
                      ) : (
                        <ImageIcon className="h-8 w-8 text-muted-foreground/60" />
                      )}
                    </div>
                    <div className="px-2 py-1.5 text-xs">
                      <div className="font-medium truncate" title={f.name}>{f.name}</div>
                      <div className="text-2xs text-muted-foreground flex items-center justify-between gap-1">
                        <span>{f.kind === 'video' ? 'Video' : 'Image'}{f.size ? ` · ${fmtSize(f.size)}` : ''}</span>
                      </div>
                    </div>
                    {isSelected && (
                      <div className="absolute top-1 right-1 bg-primary text-white rounded-full h-5 w-5 flex items-center justify-center text-3xs font-semibold">
                        ✓
                      </div>
                    )}
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
                  </button>
                )
              })}
            </div>
          </div>
        )}

        {pageToken && (
          <div className="mt-3 flex justify-center">
            <Button
              variant="outline"
              size="sm"
              disabled={loading}
              onClick={() => load({ append: true, folderId: currentFolderId, pageToken, queryStr: debouncedQuery })}
            >
              {loading ? <><Loader2 className="h-3 w-3 mr-1 animate-spin" /> Loading…</> : 'Load more'}
            </Button>
          </div>
        )}
      </div>

      {/* Action footer */}
      <div className="border-t pt-3 space-y-2.5">
        {selectedCount > 0 && (
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
            <div className="text-2xs text-muted-foreground ml-auto">
              {selectedCount} selected (max {MAX_BATCH})
            </div>
          </div>
        )}
        <div className="flex items-center gap-2 justify-end">
          {selectedCount > 0 && (
            <Button variant="ghost" size="sm" onClick={clearSelection} disabled={importing}>
              Clear
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={onClose} disabled={importing}>
            Close
          </Button>
          <Button
            size="sm"
            disabled={importing || selectedCount === 0}
            onClick={handleImport}
          >
            {importing
              ? <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> Importing {selectedCount}…</>
              : <>Import {selectedCount || ''} file{selectedCount === 1 ? '' : 's'}</>}
          </Button>
        </div>
      </div>
    </div>
  )
}
