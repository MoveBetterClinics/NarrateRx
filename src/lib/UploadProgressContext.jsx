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

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { uploadMedia, listMedia } from '@/lib/mediaLib'
import { listPausedUploads, resumePersistedUpload, abortPersistedUpload } from '@/lib/resumableUpload'

const UploadProgressContext = createContext(null)

// Same poll loop that MediaUploader used to own. Kept here so the context
// can drive the full lifecycle (upload → indexing → done) without exposing
// a leaky "rows are queryable" check to call sites.
//
// Returns the matched row (when present) so callers that need post-pipeline
// state (e.g. web_blob_url, size_bytes after resize) can read it without a
// second list call. Matches a row when EITHER blob_url or original_blob_url
// equals the just-uploaded blob URL — the image pipeline re-points blob_url
// at the web variant once it finishes, so the original URL only sticks on
// original_blob_url after the PATCH lands.
async function waitForAssetIndexed(blobUrl, { timeoutMs = 8000, intervalMs = 500 } = {}) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    try {
      const rows = await listMedia({ limit: 20, compact: true })
      const match = Array.isArray(rows)
        ? rows.find((r) => r.blob_url === blobUrl || r.original_blob_url === blobUrl)
        : null
      if (match) return match
    } catch { /* keep polling */ }
    await new Promise((r) => setTimeout(r, intervalMs))
  }
  return null
}

// After the row is indexed, poll a few more times for the image pipeline to
// re-point blob_url at the web variant (signaled by web_blob_url being set).
// Bounded short-poll because the pipeline runs immediately after the row
// insert — typical settle is ~1–3s for a 4 MB iPhone photo. If the pipeline
// errors out, this just times out and the tray shows the basic "Done." state.
async function waitForPipelineSettle(blobUrl, { timeoutMs = 12000, intervalMs = 750 } = {}) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    try {
      const rows = await listMedia({ limit: 20, compact: true })
      const match = Array.isArray(rows)
        ? rows.find((r) => r.original_blob_url === blobUrl || r.blob_url === blobUrl)
        : null
      if (match?.web_blob_url) return match
    } catch { /* keep polling */ }
    await new Promise((r) => setTimeout(r, intervalMs))
  }
  return null
}

// Recognize an AbortController-driven cancellation across the various shapes
// @vercel/blob/client + the underlying fetch can throw on abort. Different
// browser engines surface this differently (DOMException 'AbortError', a
// plain Error with name='AbortError', or a message containing 'aborted'),
// so we check loosely rather than depend on one shape.
function isAbortError(err) {
  if (!err) return false
  if (err.name === 'AbortError') return true
  if (typeof err.message === 'string' && /aborted|cancell?ed/i.test(err.message)) return true
  return false
}

export function UploadProgressProvider({ children }) {
  const [uploads, setUploads] = useState([])

  // Per-upload AbortController so the Cancel button can kill an in-flight
  // upload without affecting siblings. Ref-backed so cancelling doesn't
  // re-render the whole tray.
  const controllersRef = useRef(new Map())

  // Stash the original File + meta per row so Retry can re-run the same
  // upload after a cancel or failure. File objects don't belong in React
  // state (equality churn), so they live in a ref.
  const retryRef = useRef(new Map())

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

  // Per-row persisted-upload id (from src/lib/uploadDb). Set on every row that
  // came from a resumable upload — either freshly started (`runUpload` stores
  // it after the first /create handshake returns) or hydrated from IDB on
  // mount (`paused` rows). Tracked in a ref so dismiss can pass it to
  // abortPersistedUpload without re-reading from setUploads.
  const persistedIdRef = useRef(new Map())

  const dismissCompleted = useCallback(() => {
    setUploads((prev) => prev.filter((r) => {
      const done = r.status === 'done' || r.status === 'error' || r.status === 'canceled'
      if (done) {
        retryRef.current.delete(r.id)
        controllersRef.current.delete(r.id)
        persistedIdRef.current.delete(r.id)
      }
      return !done
    }))
  }, [])

  const dismissRow = useCallback((id) => {
    setUploads((prev) => prev.filter((r) => r.id !== id))
    retryRef.current.delete(id)
    controllersRef.current.delete(id)
    // If the dismissed row had a persisted upload (paused, or an error mid-
    // flight with parts already on Blob), best-effort tell the server to
    // abandon it and clear the IndexedDB record so it doesn't re-appear on
    // the next page load.
    const persistedId = persistedIdRef.current.get(id)
    if (persistedId) {
      abortPersistedUpload(persistedId).catch(() => {})
      persistedIdRef.current.delete(id)
    }
  }, [])

  // Internal — runs the actual upload for a row that's already been
  // registered in state. Used by startUpload (new), retryUpload (re-run),
  // and resumeUpload (continue paused). Keeps the AbortController + File ref
  // bookkeeping in one place. uploadFn is the function that does the upload
  // — either uploadMedia(file, meta, opts) for new/retry, or a closure that
  // calls resumePersistedUpload(persistedId, opts) for resume. Either way,
  // the function MUST accept { abortSignal, onProgress, onTranscodeStart,
  // onTranscodeEnd } and resolve to a blob-like { url } when done.
  const runUpload = useCallback(async (id, file, meta, uploadFn) => {
    const controller = new AbortController()
    controllersRef.current.set(id, controller)
    if (file) retryRef.current.set(id, { file, meta })

    const fileSize = file?.size || 0

    try {
      const blob = await uploadFn({
        abortSignal: controller.signal,
        onTranscodeStart: () => setUploads((prev) => prev.map((r) =>
          r.id === id ? { ...r, transcoding: true } : r,
        )),
        onTranscodeEnd: () => setUploads((prev) => prev.map((r) =>
          r.id === id ? { ...r, transcoding: false } : r,
        )),
        onProgress: (e) => {
          const total = typeof e.total === 'number' && e.total > 0 ? e.total : fileSize
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
      })

      // Persist the resumableId on the row so dismiss can abort it later.
      if (blob?.resumableId) {
        persistedIdRef.current.set(id, blob.resumableId)
      }

      setUploads((prev) => prev.map((r) =>
        r.id === id ? { ...r, status: 'indexing', progress: 100, loaded: r.total || r.size, transcoding: false } : r,
      ))
      const indexed = await waitForAssetIndexed(blob.url)
      // Capture pre-pipeline size so the savings hint compares against the
      // file the user actually picked, not whatever the server happens to
      // record post-pipeline. file.size is already the post-HEIC-transcode
      // bytes when client-side HEIC conversion fired.
      const originalSize = file?.size || fileSize
      setUploads((prev) => prev.map((r) =>
        r.id === id ? { ...r, status: 'done', slowIndex: !indexed, originalSize } : r,
      ))
      notifyUploaded()
      // Success — drop the retry stash to free the File reference.
      retryRef.current.delete(id)
      controllersRef.current.delete(id)

      // Images get an extra short poll for the resize/AI-alt pipeline to
      // settle so the tray can show "Optimized 4.2 MB → 380 KB". Best-effort
      // — if it times out, the tray just stays on the basic "Done." copy.
      if (file?.type?.startsWith('image/')) {
        waitForPipelineSettle(blob.url).then((settled) => {
          if (!settled?.size_bytes) return
          setUploads((prev) => prev.map((r) =>
            r.id === id ? { ...r, optimizedSize: settled.size_bytes } : r,
          ))
        })
      }

      return blob
    } catch (e) {
      const aborted = isAbortError(e) || controller.signal.aborted
      setUploads((prev) => prev.map((r) =>
        r.id === id
          ? {
              ...r,
              status: aborted ? 'canceled' : 'error',
              error: aborted ? null : (e?.message || 'Upload failed'),
              transcoding: false,
            }
          : r,
      ))
      // Keep retryRef populated on error/cancel so Retry can find the File.
      // Cleared on Dismiss or on successful retry.
      controllersRef.current.delete(id)
      return null
    }
  }, [notifyUploaded])

  // startUpload — public entry. Registers a fresh row + kicks off the upload
  // pipeline. Returns the final blob (or null on error/cancel) so call sites
  // can chain.
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

    return runUpload(id, file, meta, (opts) => uploadMedia(file, meta, opts))
  }, [runUpload])

  // Cancel an in-flight upload. The AbortController triggers @vercel/blob's
  // cancellation path, which aborts the multipart upload on Vercel's side
  // so we don't leak orphan parts. The row stays in the tray as 'canceled'
  // until the user dismisses it (so a fat-fingered cancel can be retried).
  const cancelUpload = useCallback((id) => {
    const controller = controllersRef.current.get(id)
    if (controller) {
      try { controller.abort() } catch { /* already aborted */ }
    }
    // If the upload was still in HEIC-transcode or hadn't reached the upload
    // yet, the abort won't surface as a thrown error from the SDK — mark the
    // row canceled defensively so the user gets immediate feedback.
    setUploads((prev) => prev.map((r) =>
      r.id === id && (r.status === 'uploading' || r.status === 'indexing')
        ? { ...r, status: 'canceled', error: null, transcoding: false }
        : r,
    ))
  }, [])

  // Re-run an upload that failed or was canceled. Uses the File + meta we
  // stashed at start. If the row already has a persistedId (a multipart
  // create handshake completed before the failure), we resume from where
  // the parts left off — never re-run /create, because a fresh /create
  // would leave the old uploadId leaked on Vercel and lose all the parts
  // already in storage.
  const retryUpload = useCallback((id) => {
    const stash = retryRef.current.get(id)
    if (!stash) return
    const persistedId = persistedIdRef.current.get(id)
    setUploads((prev) => prev.map((r) =>
      r.id === id
        ? { ...r, status: 'uploading', progress: 0, loaded: 0, error: null, transcoding: false, startedAt: Date.now() }
        : r,
    ))
    if (persistedId) {
      runUpload(id, stash.file, stash.meta, (opts) => resumePersistedUpload(persistedId, opts))
    } else {
      runUpload(id, stash.file, stash.meta, (opts) => uploadMedia(stash.file, stash.meta, opts))
    }
  }, [runUpload])

  // Resume a paused upload that was hydrated from IndexedDB on mount. The
  // file lives inside the IDB record so we don't need it from the caller —
  // just the row id. We mark the row 'uploading' and hand off to runUpload
  // with a closure around resumePersistedUpload, which re-derives missing
  // parts from the cached completedParts list.
  const resumeUpload = useCallback((id) => {
    const persistedId = persistedIdRef.current.get(id)
    if (!persistedId) return
    setUploads((prev) => prev.map((r) =>
      r.id === id
        ? { ...r, status: 'uploading', error: null, transcoding: false, startedAt: Date.now() }
        : r,
    ))
    runUpload(id, null, {}, (opts) => resumePersistedUpload(persistedId, opts))
  }, [runUpload])

  // Hydrate paused uploads from IDB on mount. Each pending IDB record becomes
  // a `paused` row in the tray with the resume button. We don't auto-resume
  // — the user may be on cellular or have intentionally walked away.
  useEffect(() => {
    let cancelled = false
    listPausedUploads().then((records) => {
      if (cancelled || records.length === 0) return
      const rows = records.map((rec) => {
        const completedBytes = (rec.completedParts || []).length * rec.partSize
        // Last completed part may be smaller, but for the paused-row hint a
        // ballpark "N% uploaded" is good enough — the precise number is
        // recomputed once the resume kicks off and the progress tracker
        // re-seeds from the actual record.
        const loaded = Math.min(rec.fileSize, completedBytes)
        const progress = rec.fileSize > 0 ? Math.round((loaded / rec.fileSize) * 100) : 0
        persistedIdRef.current.set(rec.id, rec.id)
        return {
          id: rec.id,
          name: rec.filename,
          size: rec.fileSize,
          status: 'paused',
          loaded,
          total: rec.fileSize,
          progress,
          transcoding: false,
          error: null,
          slowIndex: false,
          startedAt: rec.createdAt,
        }
      })
      setUploads((prev) => {
        const existing = new Set(prev.map((r) => r.id))
        const additions = rows.filter((r) => !existing.has(r.id))
        return additions.length ? [...prev, ...additions] : prev
      })
    }).catch(() => { /* IDB may be unavailable; not fatal */ })
    return () => { cancelled = true }
  }, [])

  const hasActiveUploads = useMemo(
    () => uploads.some((r) => r.status === 'uploading' || r.status === 'indexing'),
    [uploads],
  )

  const value = useMemo(() => ({
    uploads,
    hasActiveUploads,
    startUpload,
    cancelUpload,
    retryUpload,
    resumeUpload,
    dismissCompleted,
    dismissRow,
    subscribe,
  }), [uploads, hasActiveUploads, startUpload, cancelUpload, retryUpload, resumeUpload, dismissCompleted, dismissRow, subscribe])

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
      cancelUpload: () => {},
      retryUpload: () => {},
      resumeUpload: () => {},
      dismissCompleted: () => {},
      dismissRow: () => {},
      subscribe: () => () => {},
    }
  }
  return ctx
}
