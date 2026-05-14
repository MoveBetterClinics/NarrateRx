// UploadProgressContext — app-wide upload tracking for the Media Hub.
//
// Lifts upload state out of MediaUploader so progress survives modal close
// and in-app navigation. The floating <UploadTray/> subscribes to this
// context and renders a Gmail/Drive-style widget anchored bottom-right.
//
// Large uploads (multi-hundred-MB interview clips) are the motivating case:
// without this, dismissing the upload modal makes the in-flight `PUT` to
// Vercel Blob invisible — the upload continues in the background fetch but
// the user has no feedback for several minutes.

import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react'
import { uploadMedia, listMedia } from '@/lib/mediaLib'

const UploadProgressContext = createContext(null)

// Same poll loop that MediaUploader used to own. Kept here so the context
// can drive the full lifecycle (upload → indexing → done) without exposing
// a leaky "rows are queryable" check to call sites.
async function waitForAssetIndexed(blobUrl, { timeoutMs = 8000, intervalMs = 500 } = {}) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    try {
      const rows = await listMedia({ limit: 20, compact: true })
      if (Array.isArray(rows) && rows.some((r) => r.blob_url === blobUrl)) return true
    } catch { /* keep polling */ }
    await new Promise((r) => setTimeout(r, intervalMs))
  }
  return false
}

export function UploadProgressProvider({ children }) {
  const [uploads, setUploads] = useState([])

  // Pages that care about "an upload finished, refresh me" register via
  // subscribe(). We keep this in a ref-backed Set so subscribers added during
  // render don't trigger re-renders themselves.
  const subscribersRef = useRef(new Set())

  const subscribe = useCallback((cb) => {
    subscribersRef.current.add(cb)
    return () => { subscribersRef.current.delete(cb) }
  }, [])

  const notifyUploaded = useCallback(() => {
    for (const cb of subscribersRef.current) {
      try { cb() } catch { /* ignore subscriber errors */ }
    }
  }, [])

  const dismissCompleted = useCallback(() => {
    setUploads((prev) => prev.filter((r) => r.status !== 'done' && r.status !== 'error'))
  }, [])

  const dismissRow = useCallback((id) => {
    setUploads((prev) => prev.filter((r) => r.id !== id))
  }, [])

  // startUpload — runs HEIC transcode (if needed) → vercel/blob client upload
  // → asset-row indexing poll. Each row gets a stable id so progress updates
  // can find it without colliding with concurrent uploads of similarly-named
  // files. Returns the final blob (or null on error) so call sites can chain.
  const startUpload = useCallback(async (file, meta = {}) => {
    const id = (typeof crypto !== 'undefined' && crypto.randomUUID)
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`

    const row = {
      id,
      name: file.name,
      size: file.size || 0,
      status: 'uploading',
      loaded: 0,
      total: file.size || 0,
      progress: 0,
      transcoding: false,
      error: null,
      slowIndex: false,
      startedAt: Date.now(),
    }
    setUploads((prev) => [row, ...prev])

    try {
      const blob = await uploadMedia(
        file,
        meta,
        {
          onTranscodeStart: () => setUploads((prev) => prev.map((r) =>
            r.id === id ? { ...r, transcoding: true } : r,
          )),
          onTranscodeEnd: () => setUploads((prev) => prev.map((r) =>
            r.id === id ? { ...r, transcoding: false } : r,
          )),
          onProgress: (e) => {
            const total = typeof e.total === 'number' && e.total > 0 ? e.total : (file.size || 0)
            const loaded = typeof e.loaded === 'number' ? e.loaded : 0
            const pct = typeof e.percentage === 'number'
              ? Math.round(e.percentage)
              : (total ? Math.round((loaded / total) * 100) : 0)
            setUploads((prev) => prev.map((r) =>
              r.id === id && r.progress !== pct
                ? { ...r, loaded, total, progress: pct }
                : r,
            ))
          },
        },
      )

      setUploads((prev) => prev.map((r) =>
        r.id === id ? { ...r, status: 'indexing', progress: 100, loaded: r.total || r.size, transcoding: false } : r,
      ))
      const indexed = await waitForAssetIndexed(blob.url)
      setUploads((prev) => prev.map((r) =>
        r.id === id ? { ...r, status: 'done', slowIndex: !indexed } : r,
      ))
      notifyUploaded()
      return blob
    } catch (e) {
      setUploads((prev) => prev.map((r) =>
        r.id === id ? { ...r, status: 'error', error: e?.message || 'Upload failed', transcoding: false } : r,
      ))
      return null
    }
  }, [notifyUploaded])

  const hasActiveUploads = useMemo(
    () => uploads.some((r) => r.status === 'uploading' || r.status === 'indexing'),
    [uploads],
  )

  const value = useMemo(() => ({
    uploads,
    hasActiveUploads,
    startUpload,
    dismissCompleted,
    dismissRow,
    subscribe,
  }), [uploads, hasActiveUploads, startUpload, dismissCompleted, dismissRow, subscribe])

  return (
    <UploadProgressContext.Provider value={value}>
      {children}
    </UploadProgressContext.Provider>
  )
}

export function useUploadProgress() {
  const ctx = useContext(UploadProgressContext)
  if (!ctx) {
    // Defensive fallback so a misplaced consumer doesn't crash render. In
    // dev, surface the issue loudly.
    if (typeof window !== 'undefined' && import.meta.env?.DEV) {
      console.warn('useUploadProgress called outside <UploadProgressProvider>')
    }
    return {
      uploads: [],
      hasActiveUploads: false,
      startUpload: async () => null,
      dismissCompleted: () => {},
      dismissRow: () => {},
      subscribe: () => () => {},
    }
  }
  return ctx
}
