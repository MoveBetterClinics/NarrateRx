// UploadTray — floating "Uploads" widget that mirrors the Gmail/Drive
// pattern. Reads from <UploadProgressProvider/> so progress persists across
// modal close and in-app route changes. Speed/ETA are derived from the
// loaded-byte history kept in a ref so the context stays small.

import { useEffect, useRef, useState } from 'react'
import { ChevronDown, ChevronUp, X, Loader2, CheckCircle2, AlertCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import Icon from '@/components/ui/Icon'
import { useUploadProgress } from '@/lib/UploadProgressContext'
import { useUnsavedChanges } from '@/lib/useUnsavedChanges'

function formatBytes(n) {
  if (!n || n <= 0) return '0 B'
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

function formatEta(seconds) {
  if (!isFinite(seconds) || seconds <= 0) return ''
  if (seconds < 60) return `${Math.round(seconds)}s left`
  const m = Math.floor(seconds / 60)
  const s = Math.round(seconds % 60)
  if (m < 60) return `${m}m ${s}s left`
  const h = Math.floor(m / 60)
  return `${h}h ${m % 60}m left`
}

// Smooth speed over a short window so the number doesn't jitter on every
// progress tick. We keep up to ~3 seconds of samples per row in a ref.
function useSpeedTracker(uploads) {
  // Map<id, Array<{ t, loaded }>>
  const historyRef = useRef(new Map())
  const [, force] = useState(0)

  useEffect(() => {
    const history = historyRef.current
    const now = Date.now()
    const liveIds = new Set()
    for (const r of uploads) {
      liveIds.add(r.id)
      if (r.status !== 'uploading') continue
      const arr = history.get(r.id) || []
      arr.push({ t: now, loaded: r.loaded || 0 })
      // Keep ~3s window, capped to avoid unbounded growth on slow uploads.
      while (arr.length > 1 && now - arr[0].t > 3000) arr.shift()
      if (arr.length > 30) arr.splice(0, arr.length - 30)
      history.set(r.id, arr)
    }
    // Garbage-collect rows that no longer exist.
    for (const id of history.keys()) {
      if (!liveIds.has(id)) history.delete(id)
    }
    // Trigger a re-render at most ~2x/sec so the ETA text refreshes even
    // when the underlying progress tick interval is irregular.
    const t = setTimeout(() => force((x) => (x + 1) % 1000), 500)
    return () => clearTimeout(t)
  }, [uploads])

  return (id) => {
    const arr = historyRef.current.get(id)
    if (!arr || arr.length < 2) return { bps: 0 }
    const first = arr[0]
    const last  = arr[arr.length - 1]
    const dt = (last.t - first.t) / 1000
    if (dt <= 0) return { bps: 0 }
    const bytes = last.loaded - first.loaded
    if (bytes <= 0) return { bps: 0 }
    return { bps: bytes / dt }
  }
}

export default function UploadTray() {
  const { uploads, hasActiveUploads, dismissCompleted, dismissRow } = useUploadProgress()
  const [collapsed, setCollapsed] = useState(false)
  const getSpeed = useSpeedTracker(uploads)

  // Native "Leave site?" prompt while uploads are in flight. In-app Link
  // clicks aren't intercepted (we use JSX <BrowserRouter>), but the
  // catastrophic cases — tab close, refresh, typed URL, back button — are
  // covered. That's the failure mode that matters for a multi-hundred-MB
  // upload.
  useUnsavedChanges(hasActiveUploads)

  if (!uploads.length) return null

  const active = uploads.filter((r) => r.status === 'uploading' || r.status === 'indexing')
  const total  = uploads.length
  const totalLoaded = uploads.reduce((s, r) => s + (r.loaded || 0), 0)
  const totalBytes  = uploads.reduce((s, r) => s + (r.total  || r.size || 0), 0)
  const aggregatePct = totalBytes > 0 ? Math.round((totalLoaded / totalBytes) * 100) : 0

  const headerLabel = active.length
    ? `Uploading ${active.length} of ${total} · ${aggregatePct}%`
    : `Uploads (${total})`

  const anyDone = uploads.some((r) => r.status === 'done' || r.status === 'error')

  return (
    <div
      className="fixed right-4 bottom-4 z-[60] w-[22rem] max-w-[calc(100vw-2rem)] rounded-xl border bg-card shadow-lg"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      role="region"
      aria-label="Upload progress"
    >
      <div className="flex items-center gap-2 px-3 py-2 border-b">
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold truncate">{headerLabel}</div>
          {active.length > 0 && (
            <div
              className="mt-1 h-1 rounded-full bg-muted overflow-hidden"
              role="progressbar"
              aria-valuenow={aggregatePct}
              aria-valuemin={0}
              aria-valuemax={100}
            >
              <div
                className="h-full bg-primary transition-[width] duration-200"
                style={{ width: `${aggregatePct}%` }}
              />
            </div>
          )}
        </div>
        <button
          type="button"
          className="p-1 rounded hover:bg-muted text-muted-foreground"
          onClick={() => setCollapsed((v) => !v)}
          aria-label={collapsed ? 'Expand uploads' : 'Collapse uploads'}
        >
          {collapsed ? <Icon as={ChevronUp} size="md" /> : <Icon as={ChevronDown} size="md" />}
        </button>
      </div>

      {!collapsed && (
        <div className="max-h-72 overflow-y-auto divide-y">
          {uploads.map((r) => {
            const { bps } = getSpeed(r.id)
            const remaining = (r.total || r.size || 0) - (r.loaded || 0)
            const etaSec = bps > 0 && remaining > 0 ? remaining / bps : 0
            return (
              <div key={r.id} className="px-3 py-2">
                <div className="flex items-center gap-2 text-xs">
                  {r.status === 'uploading' && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground shrink-0" />}
                  {r.status === 'indexing'  && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground shrink-0" />}
                  {r.status === 'done'      && <CheckCircle2 className={`h-3.5 w-3.5 shrink-0 ${r.slowIndex ? 'text-warning' : 'text-success'}`} />}
                  {r.status === 'error'     && <AlertCircle className="h-3.5 w-3.5 text-destructive shrink-0" />}
                  <span className="truncate flex-1 font-medium" title={r.name}>{r.name}</span>
                  {(r.status === 'done' || r.status === 'error') && (
                    <button
                      type="button"
                      className="p-0.5 rounded hover:bg-muted text-muted-foreground"
                      onClick={() => dismissRow(r.id)}
                      aria-label={`Dismiss ${r.name}`}
                    >
                      <Icon as={X} size="xs" />
                    </button>
                  )}
                </div>

                {r.status === 'uploading' && (
                  <div className="mt-1.5">
                    {r.transcoding ? (
                      <div className="text-2xs text-muted-foreground">Converting HEIC…</div>
                    ) : (
                      <>
                        <div
                          className="h-1.5 rounded-full bg-muted overflow-hidden"
                          role="progressbar"
                          aria-valuenow={r.progress || 0}
                          aria-valuemin={0}
                          aria-valuemax={100}
                        >
                          <div
                            className="h-full bg-primary transition-[width] duration-200"
                            style={{ width: `${Math.min(100, Math.max(0, r.progress || 0))}%` }}
                          />
                        </div>
                        <div className="mt-1 flex items-center justify-between text-2xs text-muted-foreground tabular-nums">
                          <span>
                            {formatBytes(r.loaded || 0)} / {formatBytes(r.total || r.size || 0)} · {r.progress || 0}%
                          </span>
                          <span>
                            {bps > 0 ? `${formatBytes(bps)}/s` : ''}
                            {etaSec > 0 ? ` · ${formatEta(etaSec)}` : ''}
                          </span>
                        </div>
                      </>
                    )}
                  </div>
                )}
                {r.status === 'indexing' && (
                  <div className="mt-1 text-2xs text-muted-foreground">Adding to library…</div>
                )}
                {r.status === 'done' && (
                  <div className="mt-1 text-2xs text-muted-foreground">
                    {r.slowIndex
                      ? 'Still processing — will appear shortly.'
                      : (r.optimizedSize && r.originalSize && r.optimizedSize < r.originalSize)
                          ? `Optimized for web: ${formatBytes(r.originalSize)} → ${formatBytes(r.optimizedSize)}. Original kept.`
                          : 'Done.'}
                  </div>
                )}
                {r.status === 'error' && (
                  <div className="mt-1 text-2xs text-destructive truncate" title={r.error}>
                    {r.error}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {!collapsed && anyDone && (
        <div className="px-3 py-2 border-t">
          <Button variant="ghost" size="sm" className="text-xs h-7" onClick={dismissCompleted}>
            Clear finished
          </Button>
        </div>
      )}
    </div>
  )
}
