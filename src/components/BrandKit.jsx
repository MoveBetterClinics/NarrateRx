import { useEffect, useMemo, useRef, useState } from 'react'
import { useAuth } from '@clerk/clerk-react'
import {
  Upload, Search, Filter, Check, X, Sparkles, AlertCircle,
  FileText, Image as ImageIcon, Tag as TagIcon, RotateCcw, Loader2, Trash2, RefreshCw,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { FIXTURE_ASSETS, ROLE_DEFS, FIXTURE_STYLE } from '@/components/brandKitFixtures'
import { ColorPickerPopover } from '@/components/ColorPickerPopover'
import { uploadBrandAsset } from '@/lib/brandKitLib'
import { useQueryClient } from '@tanstack/react-query'
import {
  useBrandKit,
  useAssignBrandRole,
  useClearBrandRole,
  useUpdateBrandStyle,
  useDeleteBrandAsset,
} from '@/lib/queries'
import { toast } from '@/lib/toast'

// Brand Kit — three panels (Library, Roles, Style) plus an onboarding variant.
// Renders identically against the real backend (default) or fixture data
// (`mockup` prop, used by the design preview at /settings/brand-kit-preview).
//
// All data + mutations flow through one small `dataSource` object built either
// from react-query (live) or from local component state (fixtures). The view
// itself doesn't know which mode it's in.

const SHAPE_OPTIONS      = [{ id: 'horizontal', label: 'Horizontal' }, { id: 'square', label: 'Square' }, { id: 'vertical', label: 'Vertical' }, { id: 'icon', label: 'Icon' }]
const BACKGROUND_OPTIONS = [{ id: 'light', label: 'On light' }, { id: 'dark', label: 'On dark' }, { id: 'transparent', label: 'Transparent' }]
const COLOR_OPTIONS      = [{ id: 'color', label: 'Full color' }, { id: 'mono_black', label: 'Mono black' }, { id: 'mono_white', label: 'Mono white' }]
const FORMAT_OPTIONS     = [{ id: 'image/svg+xml', label: 'SVG' }, { id: 'image/png', label: 'PNG' }, { id: 'application/pdf', label: 'PDF' }]
const AUTO_ASSIGN_THRESHOLD = 0.7

function classifyChips(a) {
  const chips = []
  if (a.shape && a.shape !== 'unknown')           chips.push(a.shape)
  if (a.background && a.background !== 'unknown') chips.push(a.background === 'light' ? 'on light' : a.background === 'dark' ? 'on dark' : a.background)
  if (a.color_mode && a.color_mode !== 'unknown') chips.push(a.color_mode.replace(/_/g, ' '))
  return chips
}

function backdropStyleFor(backdrop) {
  if (backdrop === 'dark') return { backgroundColor: '#111827' }
  if (backdrop === 'light') return { backgroundColor: '#ffffff' }
  return {
    backgroundColor: '#fafafa',
    backgroundImage:
      'linear-gradient(45deg,#eef0f2 25%,transparent 25%),linear-gradient(-45deg,#eef0f2 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#eef0f2 75%),linear-gradient(-45deg,transparent 75%,#eef0f2 75%)',
    backgroundSize: '12px 12px',
    backgroundPosition: '0 0,0 6px,6px -6px,-6px 0',
  }
}

function sanitizeSvg(markup) {
  return markup
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/\son[a-z]+\s*=\s*"[^"]*"/gi, '')
    .replace(/\son[a-z]+\s*=\s*'[^']*'/gi, '')
}

// Fetches an SVG, inlines it, then rewrites the viewBox to the actual
// content bounding box so artwork that ships with whitespace padding
// (common with logo exports) fills the tile instead of rendering as a
// speck centered in a huge canvas.
function CroppedSvg({ url, label }) {
  const [markup, setMarkup] = useState(null)
  const hostRef = useRef(null)
  useEffect(() => {
    let alive = true
    fetch(url)
      .then((r) => (r.ok ? r.text() : Promise.reject(new Error(String(r.status)))))
      .then((txt) => { if (alive) setMarkup(sanitizeSvg(txt)) })
      .catch(() => { if (alive) setMarkup('') })
    return () => { alive = false }
  }, [url])
  useEffect(() => {
    if (!hostRef.current || !markup) return
    const svg = hostRef.current.querySelector('svg')
    if (!svg) return
    svg.removeAttribute('width')
    svg.removeAttribute('height')
    svg.style.display = 'block'
    svg.style.width = '100%'
    svg.style.height = '100%'
    let done = false
    const apply = () => {
      if (done || !svg.isConnected) return
      try {
        const bb = svg.getBBox()
        if (bb && bb.width > 0.5 && bb.height > 0.5) {
          const pad = Math.max(bb.width, bb.height) * 0.04
          svg.setAttribute('viewBox', `${bb.x - pad} ${bb.y - pad} ${bb.width + pad * 2} ${bb.height + pad * 2}`)
          svg.setAttribute('preserveAspectRatio', 'xMidYMid meet')
          done = true
        }
      } catch { /* ignore */ }
    }
    const timers = [0, 80, 250, 600].map((d) => setTimeout(apply, d))
    if (typeof document !== 'undefined' && document.fonts?.ready) {
      document.fonts.ready.then(apply).catch(() => {})
    }
    return () => { done = true; timers.forEach(clearTimeout) }
  }, [markup])
  // While fetching (markup === null) or on fetch failure (markup === ''),
  // fall back to a plain <img> so the user always sees something.
  if (!markup) {
    return (
      <img
        src={url}
        alt={label}
        style={{ display: 'block', width: '100%', height: '100%', objectFit: 'contain' }}
      />
    )
  }
  return (
    <div
      ref={hostRef}
      aria-label={label}
      style={{ width: '100%', height: '100%' }}
      dangerouslySetInnerHTML={{ __html: markup }}
    />
  )
}

// Renders the asset preview. `backdrop` controls what's behind the artwork —
// 'checker' (default) shows transparency, 'light'/'dark' show flat fills so
// users can spot logos that would otherwise vanish against same-color bg.
function AssetPreview({ asset, size = 'md', backdrop = 'checker' }) {
  const heightPx = size === 'sm' ? 96 : size === 'lg' ? 200 : 128
  if (asset.mime_type === 'application/pdf') {
    return (
      <div
        className="w-full rounded-md bg-rose-50 dark:bg-rose-950/30 flex flex-col items-center justify-center gap-1"
        style={{ height: `${heightPx}px` }}
      >
        <FileText className="h-8 w-8 text-rose-600 dark:text-rose-300" />
        <span className="text-3xs text-rose-700 dark:text-rose-200 font-medium uppercase tracking-wide">PDF</span>
      </div>
    )
  }
  return (
    <div
      className="w-full rounded-md overflow-hidden"
      style={{ ...backdropStyleFor(backdrop), height: `${heightPx}px`, padding: '10px', boxSizing: 'border-box' }}
    >
      {asset.mime_type === 'image/svg+xml' ? (
        <CroppedSvg url={asset.blob_url} label={asset.filename} />
      ) : (
        <img
          src={asset.blob_url}
          alt={asset.filename}
          style={{ display: 'block', width: '100%', height: '100%', objectFit: 'contain' }}
        />
      )}
    </div>
  )
}

// Single tile in the Library grid.
function LibraryTile({ asset, onOpen, roleAssignments }) {
  const assignedTo = Object.entries(roleAssignments).filter(([, id]) => id === asset.id).map(([role]) => role)
  return (
    <button
      type="button"
      onClick={() => onOpen(asset)}
      className="text-left rounded-xl border bg-card hover:border-primary/50 transition-colors overflow-hidden group"
    >
      <AssetPreview asset={asset} />
      <div className="p-2.5 space-y-1.5">
        <div className="text-2xs font-medium truncate" title={asset.filename}>{asset.filename}</div>
        <div className="flex flex-wrap gap-1">
          {classifyChips(asset).map((c) => (
            <span key={c} className="inline-block text-3xs px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground">{c}</span>
          ))}
        </div>
        {assignedTo.length > 0 && (
          <div className="flex flex-wrap gap-1 pt-1 border-t border-border/60">
            {assignedTo.map((r) => (
              <span key={r} className="inline-flex items-center gap-0.5 text-3xs px-1.5 py-0.5 rounded-full bg-success/15 text-success dark:bg-success/20 dark:text-success">
                <Check className="h-2.5 w-2.5" /> {ROLE_DEFS.find((d) => d.id === r)?.label || r}
              </span>
            ))}
          </div>
        )}
      </div>
    </button>
  )
}

// Side-panel that opens when you click a tile. Shows metadata + a "Use as…"
// list of every role with its candidate confidence (if any).
function AssetDetail({ asset, roleAssignments, onAssign, onDelete, onClose }) {
  if (!asset) return null
  const candidates = asset.ai_classification?.role_candidates || []
  const candidateMap = new Map(candidates.map((c) => [c.role, c.confidence]))
  const assignedTo = Object.entries(roleAssignments).filter(([, id]) => id === asset.id).map(([role]) => role)
  return (
    <div className="fixed inset-0 z-40 bg-black/40 flex justify-end" onClick={onClose}>
      <div className="w-full max-w-md bg-background border-l shadow-xl overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="p-4 border-b flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-sm font-semibold truncate" title={asset.filename}>{asset.filename}</div>
            <div className="text-2xs text-muted-foreground mt-0.5">
              {asset.width ? `${asset.width}×${asset.height}` : '—'} · {(asset.byte_size / 1024).toFixed(0)} KB · {asset.mime_type}
            </div>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground shrink-0"><X className="h-4 w-4" /></button>
        </div>

        <div className="p-4">
          <AssetPreview asset={asset} size="lg" />
        </div>

        <div className="px-4 pb-2">
          <div className="text-xs font-semibold mb-1.5">Auto-classified</div>
          <div className="flex flex-wrap gap-1.5">
            {classifyChips(asset).map((c) => (
              <span key={c} className="text-2xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground">{c}</span>
            ))}
            {asset.filename_tokens?.length > 0 && asset.filename_tokens.slice(0, 5).map((t) => (
              <span key={t} className="text-2xs px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 dark:bg-blue-950/50 dark:text-blue-200">#{t}</span>
            ))}
          </div>
        </div>

        <div className="px-4 py-3 border-t mt-3">
          <div className="text-xs font-semibold mb-2">Use as…</div>
          <div className="space-y-1">
            {ROLE_DEFS.map((r) => {
              const isAssigned = roleAssignments[r.id] === asset.id
              const conf = candidateMap.get(r.id)
              return (
                <div key={r.id} className="flex items-center gap-2 text-xs">
                  <button
                    type="button"
                    onClick={() => onAssign(r.id, isAssigned ? null : asset.id)}
                    className={`flex-1 text-left px-2.5 py-1.5 rounded-md border transition-colors ${
                      isAssigned
                        ? 'border-success/40 bg-success/10 dark:bg-success/15'
                        : 'border-border hover:border-primary/50'
                    }`}
                  >
                    <span className="font-medium">{r.label}</span>
                    {conf != null && (
                      <span className="ml-2 text-3xs text-muted-foreground">suggested · {Math.round(conf * 100)}%</span>
                    )}
                    {isAssigned && <Check className="inline h-3 w-3 text-success ml-2" />}
                  </button>
                </div>
              )
            })}
          </div>
        </div>

        {onDelete && (
          <div className="px-4 py-3 border-t mt-2">
            <Button
              variant="outline"
              size="sm"
              className="text-xs h-7 text-destructive hover:bg-destructive/10"
              disabled={assignedTo.length > 0}
              onClick={async () => {
                // The server already enforces this with a 409 on FK violation,
                // but disabling the button locally avoids a round trip + toast
                // for the obvious "still assigned to a role" case.
                if (assignedTo.length > 0) return
                if (!window.confirm(`Delete ${asset.filename}? The file is removed from storage too.`)) return
                await onDelete(asset.id)
                onClose()
              }}
              title={assignedTo.length > 0 ? 'Clear all role assignments first' : 'Delete asset + blob'}
            >
              <Trash2 className="h-3 w-3 mr-1.5" />
              {assignedTo.length > 0 ? 'Clear role assignments first' : 'Delete asset'}
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}

// Role assignment modal — used by the Roles panel's "Change" button.
// Surfaces the highest-confidence candidates for that role first.
function RolePickerModal({ role, assets, currentAssetId, onPick, onClose }) {
  const [backdrop, setBackdrop] = useState('checker')
  if (!role) return null
  const def = ROLE_DEFS.find((r) => r.id === role)
  const scored = assets
    .map((a) => ({ a, c: a.ai_classification?.role_candidates?.find((cc) => cc.role === role)?.confidence || 0 }))
    .sort((x, y) => y.c - x.c)
  const backdropBtn = (id, label) => (
    <button
      key={id}
      type="button"
      onClick={() => setBackdrop(id)}
      className={`text-2xs px-2 py-1 rounded border transition-colors ${
        backdrop === id ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:border-primary/40'
      }`}
    >
      {label}
    </button>
  )
  return (
    <div className="fixed inset-0 z-40 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-background rounded-xl shadow-xl w-full max-w-5xl max-h-[85vh] overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="p-4 border-b flex items-start justify-between gap-3">
          <div>
            <div className="text-sm font-semibold">Pick {def?.label}</div>
            <div className="text-xs text-muted-foreground mt-0.5">{def?.hint}</div>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <span className="text-3xs text-muted-foreground mr-1">Preview on</span>
            {backdropBtn('checker', 'Transparent')}
            {backdropBtn('light', 'Light')}
            {backdropBtn('dark', 'Dark')}
            <button onClick={onClose} className="ml-2 text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>
          </div>
        </div>
        <div className="p-4 overflow-y-auto grid grid-cols-2 sm:grid-cols-3 gap-4">
          {scored.map(({ a, c }) => {
            const isCurrent = currentAssetId === a.id
            return (
              <button
                key={a.id}
                type="button"
                onClick={() => { onPick(a.id); onClose() }}
                style={{ display: 'flex', flexDirection: 'column', height: 'auto', minHeight: '240px' }}
                className={`text-left rounded-lg border overflow-hidden transition-colors w-full ${
                  isCurrent ? 'border-success ring-2 ring-success/30' : 'border-border hover:border-primary/50'
                }`}
              >
                <div style={{ flex: '0 0 auto', width: '100%' }}>
                  <AssetPreview asset={a} size="lg" backdrop={backdrop} />
                </div>
                <div className="p-2 space-y-1" style={{ flex: '0 0 auto' }}>
                  <div className="text-3xs font-medium truncate" title={a.filename}>{a.filename}</div>
                  {c > 0 && (
                    <div className="text-3xs text-muted-foreground">
                      {Math.round(c * 100)}% match{c >= AUTO_ASSIGN_THRESHOLD ? ' · auto-pick eligible' : ''}
                    </div>
                  )}
                </div>
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}

// One row in the Roles panel.
function RoleCard({ def, asset, onChange, onClear }) {
  return (
    <div className="rounded-xl border bg-card p-3 flex items-center gap-3">
      <div className="w-24 shrink-0">
        {asset ? <AssetPreview asset={asset} size="sm" /> : (
          <div className="h-24 rounded-md border-2 border-dashed border-border flex items-center justify-center text-muted-foreground">
            <ImageIcon className="h-5 w-5" />
          </div>
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-semibold">{def.label}</div>
        <div className="text-2xs text-muted-foreground mt-0.5 leading-snug">{def.hint}</div>
        {asset && <div className="text-3xs text-muted-foreground mt-1.5 truncate" title={asset.filename}>{asset.filename}</div>}
      </div>
      <div className="flex flex-col gap-1.5 shrink-0">
        <Button size="sm" variant="outline" className="text-xs h-7" onClick={onChange}>
          {asset ? 'Change' : 'Pick'}
        </Button>
        {asset && (
          <button onClick={onClear} className="text-3xs text-muted-foreground hover:text-destructive">Clear</button>
        )}
      </div>
    </div>
  )
}

// === Main component ========================================================

// Builds the fixture-backed data source used by /settings/brand-kit-preview.
// Mirrors the live shape exactly (assets, roleAssignments, style, isLoading,
// + handler functions) so the view code below is mode-agnostic.
function useMockupDataSource() {
  const [assets, setAssets] = useState(FIXTURE_ASSETS)
  const [roleAssignments, setRoleAssignments] = useState({})
  const [style, setStyle] = useState(FIXTURE_STYLE)
  return {
    isLoading: false,
    error: null,
    assets,
    roleAssignments,
    style,
    uploading: false,
    uploadRows: [],
    assignRole: (role, assetId) => {
      setRoleAssignments((prev) => {
        const n = { ...prev }
        if (assetId == null) delete n[role]
        else n[role] = assetId
        return n
      })
    },
    clearRole: (role) => setRoleAssignments((prev) => { const n = { ...prev }; delete n[role]; return n }),
    resetRoles: () => setRoleAssignments({}),
    updateStyle: (patch) => setStyle((s) => ({ ...s, ...patch })),
    uploadFiles: () => Promise.resolve(),   // drop-zone is a no-op visual in preview
    deleteAsset: (id) => setAssets((prev) => prev.filter((a) => a.id !== id)),
    setBulkRoles: (next) => setRoleAssignments((prev) => ({ ...prev, ...next })),
  }
}

// Live data source — fetches the combined Brand Kit payload via react-query
// and exposes mutations that invalidate the cache key on success.
function useLiveDataSource() {
  const { data, isLoading, error } = useBrandKit()
  const assignMut  = useAssignBrandRole()
  const clearMut   = useClearBrandRole()
  const styleMut   = useUpdateBrandStyle()
  const deleteMut  = useDeleteBrandAsset()
  // [{ name, status: 'uploading'|'done'|'error', percent, error }]
  const [uploadRows, setUploadRows]     = useState([])
  const [uploadActive, setUploadActive] = useState(false)
  const qc = useQueryClient()

  // The DB column is `original_filename`; the view (and fixtures) read
  // `filename`. Normalize at the data-source boundary so the rest of the
  // component stays mode-agnostic.
  const assets = useMemo(
    () => (data?.assets || []).map((a) => ({ ...a, filename: a.original_filename })),
    [data?.assets],
  )
  const roleAssignments = data?.roles  || {}
  const style           = data?.style  || {}

  return {
    isLoading,
    error,
    assets,
    roleAssignments,
    style,
    uploading: uploadActive,
    uploadRows,
    assignRole: async (role, assetId) => {
      try {
        if (assetId == null) await clearMut.mutateAsync({ role })
        else await assignMut.mutateAsync({ role, assetId })
      } catch (e) { toast.error(e.message || 'Failed to update role') }
    },
    clearRole: async (role) => {
      try { await clearMut.mutateAsync({ role }) }
      catch (e) { toast.error(e.message || 'Failed to clear role') }
    },
    resetRoles: async () => {
      // No bulk-clear endpoint — issue per-role deletes in parallel. Fine for
      // the 9-role enum; revisit if the slot count ever grows.
      const filled = Object.keys(roleAssignments)
      try { await Promise.all(filled.map((role) => clearMut.mutateAsync({ role }))) }
      catch (e) { toast.error(e.message || 'Failed to reset roles') }
    },
    updateStyle: async (patch) => {
      try { await styleMut.mutateAsync(patch) }
      catch (e) { toast.error(e.message || 'Failed to update style') }
    },
    setBulkRoles: async (next) => {
      try {
        await Promise.all(
          Object.entries(next).map(([role, assetId]) => assignMut.mutateAsync({ role, assetId })),
        )
      } catch (e) { toast.error(e.message || 'Failed to apply suggested roles') }
    },
    uploadFiles: async (files) => {
      if (!files.length) return
      const rows = files.map((f) => ({ name: f.name, status: 'pending', percent: 0, error: null }))
      setUploadRows(rows)
      setUploadActive(true)
      let succeeded = 0
      const CONCURRENCY = 4
      try {
        // Upload in batches of CONCURRENCY so the library doesn't serialize 59 files
        for (let start = 0; start < files.length; start += CONCURRENCY) {
          const batch = files.slice(start, start + CONCURRENCY)
          await Promise.all(batch.map(async (file, batchIdx) => {
            const i = start + batchIdx
            setUploadRows((prev) => prev.map((r, j) => j === i ? { ...r, status: 'uploading', percent: 0 } : r))
            try {
              await uploadBrandAsset(file, {}, {
                onProgress: (e) => {
                  setUploadRows((prev) => prev.map((r, j) => j === i ? { ...r, percent: e.percentage ?? 0 } : r))
                },
              })
              setUploadRows((prev) => prev.map((r, j) => j === i ? { ...r, status: 'done', percent: 100 } : r))
              succeeded++
            } catch (e) {
              setUploadRows((prev) => prev.map((r, j) => j === i ? { ...r, status: 'error', error: e.message || 'upload failed' } : r))
            }
          }))
        }
      } finally {
        setUploadActive(false)
        if (succeeded > 0) {
          qc.invalidateQueries({ queryKey: ['brandKit'] })
          // Upload webhook may auto-assign roles (incl. primary_logo) server-side
          // — refresh the workspace row so the header logo picks up the change.
          qc.invalidateQueries({ queryKey: ['workspace', 'me'] })
          // Brand book PDFs trigger async extraction (waitUntil) that writes
          // back to the DB seconds after the upload completes. A second
          // invalidation catches those results without a manual page refresh.
          const hasPdf = files.some((f) => f.type === 'application/pdf' || f.name.endsWith('.pdf'))
          if (hasPdf) {
            setTimeout(() => {
              qc.invalidateQueries({ queryKey: ['brandKit'] })
              qc.invalidateQueries({ queryKey: ['workspace', 'me'] })
            }, 8000)
          }
        }
      }
    },
    deleteAsset: async (id) => {
      try { await deleteMut.mutateAsync({ id }) }
      catch (e) { toast.error(e.message || 'Failed to delete asset') }
    },
    clearUploadRows: () => setUploadRows([]),
  }
}

// Recursively collects File objects from a DataTransferItemList. Handles
// both plain files and folder drops (using webkitGetAsEntry). Skips macOS
// metadata files (.__*) and hidden dot-files that designers' folders often
// include but should never be uploaded as brand assets.
function readDirectoryEntries(reader) {
  return new Promise((resolve) => {
    const out = []
    function read() {
      reader.readEntries((entries) => {
        if (!entries.length) return resolve(out)
        out.push(...entries)
        read()
      }, () => resolve(out))
    }
    read()
  })
}
async function entryToFiles(entry) {
  if (!entry) return []
  if (entry.isFile) {
    return new Promise((resolve) => entry.file((f) => resolve([f]), () => resolve([])))
  }
  if (entry.isDirectory) {
    const reader = entry.createReader()
    const children = await readDirectoryEntries(reader)
    const nested = await Promise.all(children.map(entryToFiles))
    return nested.flat()
  }
  return []
}
async function collectFilesFromItems(items) {
  const entries = items.map((item) => item.webkitGetAsEntry?.()).filter(Boolean)
  const nested  = await Promise.all(entries.map(entryToFiles))
  return nested.flat().filter((f) =>
    f.size > 0 && !f.name.startsWith('.') && !f.name.startsWith('.__')
  )
}

export default function BrandKit({ variant = 'settings', mockup = false, onAdvance }) {
  const isOnboarding = variant === 'onboarding'
  const qc = useQueryClient()
  // Both hooks are declared so React's hook order stays consistent across
  // renders. The `mockup` prop is set at mount time and doesn't change, so
  // picking one of the two return values is safe.
  const liveSource   = useLiveDataSource()
  const mockSource   = useMockupDataSource()
  const ds           = mockup ? mockSource : liveSource
  const { assets, roleAssignments, style, isLoading, error, uploading, uploadRows } = ds
  // Keep the original local-state aliases used below as setters → forward to
  // the data source so the rest of the component code stays the same.
  const setRoleAssignments = (next) => {
    if (typeof next === 'function') {
      const computed = next(roleAssignments)
      // Compare key-by-key to figure out the diff and dispatch the right calls.
      const removed = Object.keys(roleAssignments).filter((k) => !(k in computed))
      const added   = Object.entries(computed).filter(([k, v]) => roleAssignments[k] !== v)
      removed.forEach((k) => ds.clearRole(k))
      added.forEach(([k, v]) => ds.assignRole(k, v))
      return
    }
    // Direct object assignment — same diff logic.
    const removed = Object.keys(roleAssignments).filter((k) => !(k in next))
    const added   = Object.entries(next).filter(([k, v]) => roleAssignments[k] !== v)
    removed.forEach((k) => ds.clearRole(k))
    added.forEach(([k, v]) => ds.assignRole(k, v))
  }
  const setStyle = (next) => {
    const patch = typeof next === 'function' ? next(style) : next
    // Compute just the diff so we don't re-send unchanged fields.
    const diff = {}
    for (const k of Object.keys(patch)) {
      if (JSON.stringify(patch[k]) !== JSON.stringify(style[k])) diff[k] = patch[k]
    }
    if (Object.keys(diff).length > 0) ds.updateStyle(diff)
  }

  const [search, setSearch]           = useState('')
  const [shapeFilter, setShape]       = useState(null)
  const [bgFilter, setBg]             = useState(null)
  const [colorFilter, setColor]       = useState(null)
  const [formatFilter, setFormat]     = useState(null)
  const [openAsset, setOpenAsset]     = useState(null)
  const [pickerRole, setPickerRole]   = useState(null)
  const [confirmStrip, setConfirmStrip]   = useState(null)  // onboarding auto-assign confirmation
  const [adjusting, setAdjusting]         = useState(false)  // onboarding "Let me adjust" expanded view
  const [autoAssigning, setAutoAssigning] = useState(false)
  const [customColorDraft, setCustomColorDraft] = useState('')
  const [addingCustomColor, setAddingCustomColor] = useState(false)
  const [reclassifying, setReclassifying] = useState(false)

  const filtered = useMemo(() => {
    return assets.filter((a) => {
      if (search && !a.filename.toLowerCase().includes(search.toLowerCase()) &&
          !(a.filename_tokens || []).some((t) => t.includes(search.toLowerCase()))) return false
      if (shapeFilter  && a.shape      !== shapeFilter)  return false
      if (bgFilter     && a.background !== bgFilter)     return false
      if (colorFilter  && a.color_mode !== colorFilter)  return false
      if (formatFilter && a.mime_type  !== formatFilter) return false
      return true
    })
  }, [assets, search, shapeFilter, bgFilter, colorFilter, formatFilter])

  async function autoAssign() {
    const newAssignments = {}
    const picked = []
    for (const role of ROLE_DEFS) {
      if (roleAssignments[role.id]) continue
      const best = assets
        .map((a) => ({ a, c: a.ai_classification?.role_candidates?.find((cc) => cc.role === role.id)?.confidence || 0 }))
        .sort((x, y) => y.c - x.c)[0]
      if (best && best.c >= AUTO_ASSIGN_THRESHOLD) {
        newAssignments[role.id] = best.a.id
        picked.push({ role: role.id, asset: best.a, confidence: best.c })
      }
    }
    if (Object.keys(newAssignments).length === 0) {
      toast.info(assets.length === 0
        ? 'Upload some assets first'
        : 'No unassigned roles with confident matches — assign manually or re-tag assets')
      return
    }
    setAutoAssigning(true)
    try {
      // Single batched mutation rather than N parallel "assign" calls — keeps
      // the live path from spamming the API and the mockup path from N
      // re-renders.
      await ds.setBulkRoles(newAssignments)
      if (!isOnboarding) toast.success(`Assigned ${picked.length} role${picked.length === 1 ? '' : 's'}`)
    } finally {
      setAutoAssigning(false)
    }
    if (isOnboarding) setConfirmStrip(picked)
  }

  async function resetAssignments() {
    await ds.resetRoles()
    setConfirmStrip(null)
  }

  // File input + drop handlers for the Library drop zone. Both routes feed
  // ds.uploadFiles, which is either the real Vercel-Blob direct upload or a
  // no-op (preview mode).
  const fileInputRef = useRef(null)
  function handleFiles(fileList) {
    const files = Array.from(fileList || [])
    if (!files.length) return
    ds.uploadFiles(files)
  }
  async function handleDrop(e) {
    e.preventDefault()
    // Use DataTransferItem + webkitGetAsEntry to recurse into dropped folders.
    // e.dataTransfer.files only gives a stub for directories (size 0, no type).
    const items = Array.from(e.dataTransfer?.items || [])
    if (!items.length) return
    const files = await collectFilesFromItems(items)
    if (files.length) ds.uploadFiles(files)
  }

  const filledRoles = Object.keys(roleAssignments).length
  const totalRoles  = ROLE_DEFS.length

  // First-load gate. After the initial fetch, we render the panels with empty
  // state so subsequent refetches don't blank the page.
  if (isLoading && !mockup) {
    return (
      <div className="max-w-6xl mx-auto p-6 flex items-center justify-center min-h-[40vh]">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }
  if (error && !mockup) {
    return (
      <div className="max-w-6xl mx-auto p-6">
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          Failed to load brand kit: {error.message || 'unknown error'}
        </div>
      </div>
    )
  }

  // ---- Onboarding confirmation strip --------------------------------------
  // After auto-assign in onboarding, condense to a single "looks right?" strip
  // instead of dumping the full Roles panel on the user. They can hit
  // "Looks good" to advance, or "Let me adjust" to expand into the full panel.
  if (isOnboarding && confirmStrip) {
    return (
      <div className="max-w-3xl mx-auto p-6 space-y-4">
        <div className="text-center space-y-2">
          <Sparkles className="h-8 w-8 text-primary mx-auto" />
          <h1 className="text-xl font-semibold">We picked these for your workspace</h1>
          <p className="text-sm text-muted-foreground">Based on your filenames and image shapes. You can adjust any of these later in Settings.</p>
        </div>
        <div className="space-y-2">
          {confirmStrip.map(({ role, asset, confidence }) => {
            const def = ROLE_DEFS.find((d) => d.id === role)
            return (
              <div key={role} className="rounded-lg border bg-card p-3 flex items-center gap-3">
                <div className="w-16 shrink-0"><AssetPreview asset={asset} size="sm" /></div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium">{def?.label}</div>
                  <div className="text-2xs text-muted-foreground truncate">{asset.filename} · {Math.round(confidence * 100)}% match</div>
                </div>
              </div>
            )
          })}
        </div>
        <div className="flex gap-2 justify-center pt-2">
          <Button
            variant="outline"
            onClick={() => { setConfirmStrip(null); setAdjusting(true) }}
          >
            Let me adjust
          </Button>
          <Button onClick={() => onAdvance?.()}>Looks good — continue</Button>
        </div>
      </div>
    )
  }

  // ---- Default render -----------------------------------------------------
  return (
    <div className={`${isOnboarding ? 'max-w-4xl mx-auto p-6' : 'max-w-6xl mx-auto p-6'} space-y-6`}>
      {isOnboarding && (
        <div className="text-center space-y-1">
          <h1 className="text-xl font-semibold">Add your brand assets</h1>
          <p className="text-sm text-muted-foreground">Drop your logo files — a whole folder is fine, we&rsquo;ll sort them.</p>
        </div>
      )}

      {!isOnboarding && !roleAssignments.primary_logo && (
        <div className="rounded-lg border border-warning/40 bg-warning/10 dark:bg-warning/15 p-3 flex items-start gap-2">
          <AlertCircle className="h-4 w-4 text-warning shrink-0 mt-0.5" />
          <div className="text-xs text-warning">
            <strong>No primary logo set.</strong>{' '}
            {assets.length === 0
              ? 'Upload your logo files and assign one as the primary logo so downstream channels (email, social, site) render with the right artwork.'
              : 'Pick a primary logo from your assets so downstream channels (email, social, site) render with the right artwork.'}
          </div>
        </div>
      )}

      {/* ===== LIBRARY PANEL ================================================ */}
      <section className="space-y-3">
        {!isOnboarding && (
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Library</h2>
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">{filtered.length} of {assets.length} assets</span>
              <Button
                size="sm" variant="ghost" className="text-xs h-7 text-muted-foreground"
                disabled={reclassifying}
                onClick={async () => {
                  setReclassifying(true)
                  try {
                    const token = await window.Clerk?.session?.getToken?.()
                    const r = await fetch('/api/brand-kit/reclassify', {
                      method: 'POST',
                      headers: token ? { Authorization: `Bearer ${token}` } : {},
                    })
                    const data = await r.json()
                    if (r.ok) {
                      toast.success(`Re-tagged ${data.updated} of ${data.total} assets`)
                      qc.invalidateQueries({ queryKey: ['brandKit'] })
                    } else {
                      toast.error(data.error || 'Re-classify failed')
                    }
                  } catch (err) {
                    toast.error('Re-classify failed', { description: err.message })
                  } finally {
                    setReclassifying(false)
                  }
                }}
                title="Re-run AI classifier on all assets"
              >
                <RefreshCw className="h-3 w-3 mr-1" /> Re-tag
              </Button>
            </div>
          </div>
        )}

        {/* Drop zone. Click → opens file picker; drag-and-drop also supported.
            In preview/mockup mode the upload is a no-op so the visual reads
            "clickable" without writing anything. */}
        <div
          onClick={() => fileInputRef.current?.click()}
          onDragOver={(e) => e.preventDefault()}
          onDrop={handleDrop}
          className="rounded-xl border-2 border-dashed border-border hover:border-primary/50 hover:bg-accent/20 transition-colors p-8 text-center cursor-pointer"
        >
          {uploading ? (
            <Loader2 className="h-8 w-8 text-primary mx-auto mb-2 animate-spin" />
          ) : (
            <Upload className="h-8 w-8 text-muted-foreground/50 mx-auto mb-2" />
          )}
          <p className="text-sm font-medium mb-0.5">
            {uploading
              ? `Uploading ${uploadRows.filter(r => r.status === 'done').length} of ${uploadRows.length}…`
              : 'Drop logo files, a whole folder, or click to browse'}
          </p>
          <p className="text-xs text-muted-foreground">SVG, PNG, JPG, WebP, PDF · uploads stay private to your workspace</p>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/svg+xml,image/png,image/jpeg,image/webp,application/pdf"
          multiple
          className="hidden"
          onChange={(e) => handleFiles(e.target.files)}
        />

        {/* Persistent upload status — stays visible until user dismisses or starts a new upload */}
        {uploadRows.length > 0 && (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">
                {uploadRows.filter(r => r.status === 'done').length} of {uploadRows.length} uploaded
                {uploadRows.some(r => r.status === 'error') && ` · ${uploadRows.filter(r => r.status === 'error').length} failed`}
              </span>
              {!uploading && (
                <button
                  type="button"
                  onClick={() => liveSource.clearUploadRows?.()}
                  className="text-3xs text-muted-foreground hover:text-foreground"
                >Dismiss</button>
              )}
            </div>
            {uploadRows.map((row, i) => (
              <div key={i} className="rounded-lg border bg-card px-3 py-2 space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs truncate flex-1" title={row.name}>{row.name}</span>
                  {row.status === 'uploading' && <Loader2 className="h-3 w-3 animate-spin text-primary shrink-0" />}
                  {row.status === 'done'      && <Check className="h-3 w-3 text-success shrink-0" />}
                  {row.status === 'error'     && <AlertCircle className="h-3 w-3 text-destructive shrink-0" />}
                </div>
                {row.status === 'uploading' && (
                  <div className="h-1 rounded-full bg-muted overflow-hidden">
                    <div
                      className="h-full bg-primary transition-all duration-200"
                      style={{ width: `${row.percent}%` }}
                    />
                  </div>
                )}
                {row.status === 'error' && (
                  <p className="text-2xs text-destructive">{row.error}</p>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Filter bar */}
        {!isOnboarding && (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <div className="relative flex-1 max-w-sm">
                <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search by filename or tag…"
                  className="pl-7 h-8 text-xs"
                />
              </div>
              <div className="flex items-center gap-1 text-xs text-muted-foreground">
                <Filter className="h-3.5 w-3.5" /> Filter
              </div>
            </div>
            <FilterChipGroup label="Shape"      options={SHAPE_OPTIONS}      value={shapeFilter}  onChange={setShape} />
            <FilterChipGroup label="Background" options={BACKGROUND_OPTIONS} value={bgFilter}     onChange={setBg} />
            <FilterChipGroup label="Color"      options={COLOR_OPTIONS}      value={colorFilter}  onChange={setColor} />
            <FilterChipGroup label="Format"     options={FORMAT_OPTIONS}     value={formatFilter} onChange={setFormat} />
          </div>
        )}

        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
          {filtered.map((a) => (
            <LibraryTile key={a.id} asset={a} onOpen={setOpenAsset} roleAssignments={roleAssignments} />
          ))}
        </div>
      </section>

      {/* ===== ROLES PANEL ================================================== */}
      {(!isOnboarding || adjusting) ? (
        <section className="space-y-3">
          <div className="flex items-baseline justify-between gap-2">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Roles</h2>
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">{filledRoles} / {totalRoles} filled</span>
              <Button size="sm" variant="outline" className="text-xs h-7" onClick={resetAssignments} disabled={filledRoles === 0}>
                <RotateCcw className="h-3 w-3 mr-1" /> Reset
              </Button>
              <Button size="sm" className="text-xs h-7" onClick={autoAssign} disabled={autoAssigning}>
                {autoAssigning
                  ? <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                  : <Sparkles className="h-3 w-3 mr-1" />}
                Auto-assign suggested
              </Button>
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {ROLE_DEFS.map((def) => (
              <RoleCard
                key={def.id}
                def={def}
                asset={assets.find((a) => a.id === roleAssignments[def.id]) || null}
                onChange={() => setPickerRole(def.id)}
                onClear={() => setRoleAssignments((prev) => { const n = { ...prev }; delete n[def.id]; return n })}
              />
            ))}
          </div>
          {isOnboarding && adjusting && (
            <div className="flex items-center justify-center gap-3 pt-2">
              <button
                type="button"
                onClick={() => onAdvance?.()}
                className="text-xs text-muted-foreground hover:text-foreground underline-offset-4 hover:underline"
              >
                Skip for now
              </button>
              <Button onClick={() => onAdvance?.()}>Done — continue</Button>
            </div>
          )}
        </section>
      ) : (
        <div className="flex flex-col items-center gap-2 pt-2">
          <Button onClick={autoAssign} disabled={assets.length === 0}>
            <Sparkles className="h-4 w-4 mr-1.5" /> Auto-assign & continue
          </Button>
          <button
            type="button"
            onClick={() => onAdvance?.()}
            className="text-xs text-muted-foreground hover:text-foreground underline-offset-4 hover:underline"
          >
            Skip for now
          </button>
        </div>
      )}

      {/* ===== STYLE PANEL ================================================== */}
      {!isOnboarding && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Style</h2>
          <div className="rounded-xl border bg-card p-4 space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Accent color</Label>
                <div className="flex items-center gap-2 mt-1">
                  <ColorPickerPopover
                    value={style.accent_color || '#000000'}
                    onChange={(hex) => setStyle((s) => ({ ...s, accent_color: hex }))}
                    ariaLabel="Pick accent color"
                  />
                  <Input value={style.accent_color || ''} onChange={(e) => setStyle((s) => ({ ...s, accent_color: e.target.value }))} className="h-8 text-xs font-mono" placeholder="#0a7f3f" />
                </div>
              </div>
              <div className="sm:col-span-2">
                <Label className="text-xs">Secondary colors</Label>
                {/* Palette suggested by brand book — swatches not yet added */}
                {(() => {
                  const added = new Set((style.secondary_colors || []).map((c) => c.toUpperCase()))
                  const accent = (style.accent_color || '').toUpperCase()
                  const suggestions = (style.suggested_palette || [])
                    .filter((c) => c.toUpperCase() !== accent && !added.has(c.toUpperCase()))
                  if (!suggestions.length) return null
                  return (
                    <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                      <span className="text-3xs text-muted-foreground shrink-0">From brand book:</span>
                      {suggestions.map((c) => (
                        <button
                          key={c}
                          title={`Add ${c}`}
                          onClick={() => setStyle((s) => ({ ...s, secondary_colors: [...(s.secondary_colors || []), c] }))}
                          className="flex items-center gap-1 rounded-md border px-1.5 py-0.5 hover:border-primary/60 hover:bg-accent/30 transition-colors text-2xs font-mono"
                        >
                          <div className="w-3.5 h-3.5 rounded-sm shrink-0" style={{ background: c }} />
                          {c}
                        </button>
                      ))}
                    </div>
                  )
                })()}
                {/* Added colors */}
                <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                  {(style.secondary_colors || []).map((c, i) => (
                    <div key={i} className="flex items-center gap-1 rounded-md border px-1.5 py-0.5">
                      <div className="w-4 h-4 rounded" style={{ background: c }} />
                      <span className="text-2xs font-mono">{c}</span>
                      <button
                        onClick={() => setStyle((s) => ({ ...s, secondary_colors: (s.secondary_colors || []).filter((_, j) => j !== i) }))}
                        className="text-muted-foreground hover:text-destructive"
                      ><X className="h-3 w-3" /></button>
                    </div>
                  ))}
                  {addingCustomColor ? (
                    <div className="flex items-center gap-1.5">
                      <ColorPickerPopover
                        value={customColorDraft || '#888888'}
                        onChange={(hex) => setCustomColorDraft(hex)}
                        swatchClassName="h-7 w-10"
                        ariaLabel="Pick secondary color"
                      />
                      <Input
                        value={customColorDraft}
                        onChange={(e) => setCustomColorDraft(e.target.value)}
                        className="h-7 w-24 text-xs font-mono"
                        placeholder="#000000"
                      />
                      <Button size="sm" className="h-7 text-2xs" onClick={() => {
                        const hex = customColorDraft.trim()
                        if (/^#[0-9a-f]{3,6}$/i.test(hex)) {
                          setStyle((s) => ({ ...s, secondary_colors: [...(s.secondary_colors || []), hex.toUpperCase()] }))
                        }
                        setAddingCustomColor(false)
                        setCustomColorDraft('')
                      }}>Add</Button>
                      <Button size="sm" variant="ghost" className="h-7 text-2xs" onClick={() => { setAddingCustomColor(false); setCustomColorDraft('') }}>Cancel</Button>
                    </div>
                  ) : (
                    <Button size="sm" variant="ghost" className="h-6 text-2xs"
                      onClick={() => { setCustomColorDraft(''); setAddingCustomColor(true) }}
                    >+ Add custom</Button>
                  )}
                </div>
              </div>
              <div>
                <Label className="text-xs">Heading font</Label>
                <Input value={style.heading_font || ''} onChange={(e) => setStyle((s) => ({ ...s, heading_font: e.target.value }))} className="h-8 text-xs mt-1" placeholder="e.g. Inter" />
              </div>
              <div>
                <Label className="text-xs">Body font</Label>
                <Input value={style.body_font || ''} onChange={(e) => setStyle((s) => ({ ...s, body_font: e.target.value }))} className="h-8 text-xs mt-1" placeholder="e.g. Source Sans 3" />
              </div>
            </div>
            <p className="text-2xs text-muted-foreground flex items-start gap-1.5">
              <TagIcon className="h-3 w-3 mt-0.5 shrink-0" />
              Font names are stored as strings; the rendering layer (email, site, social) honors them where the channel supports custom fonts and falls back to system defaults otherwise.
            </p>
          </div>
        </section>
      )}

      {!isOnboarding && !mockup && <BrandBookReference />}

      <AssetDetail
        asset={openAsset}
        roleAssignments={roleAssignments}
        onAssign={(role, assetId) => {
          setRoleAssignments((prev) => {
            const n = { ...prev }
            if (assetId == null) delete n[role]
            else n[role] = assetId
            return n
          })
        }}
        onDelete={ds.deleteAsset}
        onClose={() => setOpenAsset(null)}
      />

      <RolePickerModal
        role={pickerRole}
        assets={assets}
        currentAssetId={pickerRole ? roleAssignments[pickerRole] : null}
        onPick={(assetId) => setRoleAssignments((prev) => ({ ...prev, [pickerRole]: assetId }))}
        onClose={() => setPickerRole(null)}
      />
    </div>
  )
}

// Brand book URL + notes — stored on `workspaces.brandbook` JSONB, separate
// from brand_kit_style. Fetches the current values from /api/workspace/me on
// mount and persists with a PATCH on save. Lives in Brand Kit because the
// brand book is a brand asset; the General tab no longer surfaces these.
function BrandBookReference() {
  const { getToken } = useAuth()
  const [pristine, setPristine] = useState(null) // null = loading
  const [url, setUrl] = useState('')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    fetch('/api/workspace/me')
      .then(r => r.ok ? r.json() : null)
      .catch(() => null)
      .then((ws) => {
        const u = ws?.brandbook?.url   ?? ''
        const n = ws?.brandbook?.notes ?? ''
        setUrl(u)
        setNotes(n)
        setPristine({ url: u, notes: n })
      })
  }, [])

  const isDirty = pristine && (url !== pristine.url || notes !== pristine.notes)

  async function handleSave() {
    setSaving(true); setError(null); setSaved(false)
    try {
      const token = await getToken()
      const r = await fetch('/api/workspace/me', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ brandbook: { url: url || null, notes: notes || null } }),
      })
      if (!r.ok) {
        const err = await r.json().catch(() => ({}))
        setError(err.error || 'save-failed')
      } else {
        setPristine({ url, notes })
        setSaved(true)
        setTimeout(() => setSaved(false), 3000)
      }
    } catch {
      setError('network-error')
    } finally {
      setSaving(false)
    }
  }

  if (pristine === null) return null

  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Brand book reference</h2>
      <div className="rounded-xl border bg-card p-4 space-y-3">
        <div>
          <Label className="text-xs">Brand book URL</Label>
          <Input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://..."
            className="h-8 text-xs mt-1"
          />
          <p className="text-2xs text-muted-foreground mt-1">
            Link to your brand guidelines — Notion page, Figma file, Drive PDF, etc.
          </p>
        </div>
        <div>
          <Label className="text-xs">Brand book notes</Label>
          <Textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={4}
            className="text-xs mt-1 resize-y"
            placeholder="Anything an image generator or designer should know — typography rules, photo style, what to avoid."
          />
        </div>
        <div className="flex items-center gap-2 justify-end">
          {error && <span className="text-xs text-destructive">{error}</span>}
          {saved && !isDirty && <span className="text-xs text-success">Saved</span>}
          <Button size="sm" onClick={handleSave} disabled={saving || !isDirty}>
            {saving ? <><Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />Saving…</> : 'Save'}
          </Button>
        </div>
      </div>
    </section>
  )
}

function FilterChipGroup({ label, options, value, onChange }) {
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      <span className="text-3xs uppercase tracking-wide text-muted-foreground w-20 shrink-0">{label}</span>
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          onClick={() => onChange(value === o.id ? null : o.id)}
          className={`text-2xs px-2 py-0.5 rounded-full border transition-colors ${
            value === o.id
              ? 'bg-primary text-primary-foreground border-primary'
              : 'bg-muted/40 text-muted-foreground border-border hover:border-primary/40'
          }`}
        >{o.label}</button>
      ))}
    </div>
  )
}
