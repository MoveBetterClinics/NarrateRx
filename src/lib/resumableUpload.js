// Cross-page-reload resumable upload orchestrator for the Media Hub.
//
// Replaces the single @vercel/blob/client#upload() call in mediaLib.js with
// a manually-managed multipart flow:
//
//   1. POST /api/media/multipart/create
//        Server reserves a Vercel Blob multipart upload, mints a 24h client
//        token, returns { uploadId, key, pathname, clientToken,
//        tokenPayloadServer }.
//
//   2. Client persists the record (incl. the File itself — File survives a
//      structured-clone into IndexedDB) so a tab close / sleep / refresh
//      doesn't lose the upload state.
//
//   3. Client splits the File into parts (~10 MB each, scaled up for huge
//      files to stay under Vercel's 10k-part ceiling). Parallel workers
//      call @vercel/blob/client#uploadPart with the client token. After each
//      part lands, the etag is appended to completedParts in IndexedDB.
//
//   4. When every part has landed, client POSTs /api/media/multipart/complete
//      with { uploadId, key, pathname, contentType, parts[], tokenPayloadServer,
//      totalSize }. Server calls completeMultipartUpload and runs the same
//      recordUploadedAsset pipeline as single-shot uploads.
//
//   5. On success, the IndexedDB record is deleted.
//
// Resume model:
//   - Existing pending records are surfaced as `paused` rows by
//     UploadProgressProvider on mount (not auto-resumed — user may be on
//     cellular). Calling resumePersistedUpload() filters out already-
//     completed parts and uploads the rest, then completes.
//   - fileLastModified is compared on resume to detect "user edited the file
//     between sessions" — mismatch marks the record expired and clears it.
//   - Tokens are 24h. A token-expired record on resume is also marked expired.

import { uploadPart } from '@vercel/blob/client'
import { putUpload, patchUpload, deleteUpload, getUpload } from '@/lib/uploadDb'
import { throwApiError } from '@/lib/apiError'

const TARGET_PART_SIZE = 10 * 1024 * 1024  // 10 MB default
const MIN_PART_SIZE    = 5  * 1024 * 1024  // Vercel/S3 floor (last part exempt)
const MAX_PARTS        = 9000              // headroom under Vercel's 10k cap
const PART_CONCURRENCY = 4

async function getClerkToken() {
  if (typeof window === 'undefined') return null
  try {
    return await window.Clerk?.session?.getToken?.()
  } catch {
    return null
  }
}

async function api(path, init = {}) {
  const token = await getClerkToken()
  const headers = { 'Content-Type': 'application/json', ...(init.headers || {}) }
  if (token) headers.Authorization = `Bearer ${token}`
  const res = await fetch(path, { ...init, headers })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    await throwApiError(new Response(text, { status: res.status, headers: res.headers }))
  }
  return res.json().catch(() => ({}))
}

// Choose a part size that keeps part count under MAX_PARTS while honoring the
// platform minimum. For a 2 GB video at 10 MB parts that's 200 parts; for a
// 200 GB file we scale up to ~25 MB parts to stay under MAX_PARTS.
export function pickPartSize(fileSize) {
  let size = TARGET_PART_SIZE
  while (Math.ceil(fileSize / size) > MAX_PARTS) {
    size *= 2
  }
  return Math.max(size, MIN_PART_SIZE)
}

function totalParts(fileSize, partSize) {
  return Math.max(1, Math.ceil(fileSize / partSize))
}

// AbortError detection across browser flavors. @vercel/blob throws either a
// DOMException or a plain Error with the name set, depending on whether the
// underlying fetch or the SDK's own AbortController triggered the abort.
export function isAbortError(err) {
  if (!err) return false
  if (err.name === 'AbortError') return true
  if (typeof err.message === 'string' && /aborted|cancell?ed/i.test(err.message)) return true
  return false
}

// Run upload tasks with a bounded worker pool. Resolves when every task is
// done; rejects on the first error (other workers receive the abort signal).
async function runWithConcurrency(items, concurrency, worker, abortSignal) {
  const queue = items.slice()
  let firstErr = null
  const next = async () => {
    while (queue.length) {
      if (abortSignal?.aborted) {
        firstErr = firstErr || new DOMException('aborted', 'AbortError')
        return
      }
      const item = queue.shift()
      try {
        await worker(item)
      } catch (e) {
        firstErr = firstErr || e
        return
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, next))
  if (firstErr) throw firstErr
}

// Single shared progress aggregator. We can't trust onUploadProgress to fire
// monotonically across all parts (some parts may be re-uploaded after retry),
// so we keep the *last reported* value per part number and sum.
function makeProgressTracker(completedParts, fileSize, onProgress) {
  // partNumber → bytes loaded for that part (from progress callback).
  const liveByPart = new Map()
  // Bytes locked in by already-completed parts at start of run.
  let baselineLoaded = 0
  for (const _p of completedParts) {
    // We don't know per-part sizes; approximate with TARGET_PART_SIZE except
    // for the last. The aggregate is re-corrected once all parts complete.
    baselineLoaded += 0  // see updateCompleted below
  }

  function emit() {
    let live = 0
    for (const v of liveByPart.values()) live += v
    const loaded = Math.min(fileSize, baselineLoaded + live)
    const pct = fileSize > 0 ? Math.round((loaded / fileSize) * 100) : 0
    onProgress?.({ loaded, total: fileSize, percentage: pct })
  }

  return {
    setPartLive(partNumber, loaded) {
      liveByPart.set(partNumber, loaded)
      emit()
    },
    markPartDone(partNumber, partSize) {
      liveByPart.delete(partNumber)
      baselineLoaded += partSize
      emit()
    },
    seedCompleted(parts, fullPartSize, totalCount) {
      // Reconstruct baseline from prior completedParts on resume. Every
      // completed part except possibly the last is fullPartSize bytes.
      for (const p of parts) {
        const isLast = p.partNumber === totalCount
        const sz = isLast ? (fileSize - (totalCount - 1) * fullPartSize) : fullPartSize
        baselineLoaded += sz
      }
      emit()
    },
  }
}

// Build the canonical pathname the way mediaLib.js did pre-multipart. The
// server recomputes its own pathname inside /create, so this is informational
// only (kept for display + telemetry). The authoritative pathname comes back
// in the /create response.
function buildSuggestedPathname(file, meta) {
  const ext      = (file.name.match(/\.[^.]+$/) || [''])[0]
  const baseName = file.name.replace(/\.[^.]+$/, '').replace(/[^a-z0-9-_]+/gi, '-').toLowerCase()
  const stamp    = new Date().toISOString().replace(/[:.]/g, '-')
  const folder   = meta.parentId ? 'media/edited' : 'media/raw'
  return `${folder}/${stamp}-${baseName}${ext}`
}

// New upload entry point. Used by mediaLib.uploadMedia for the first attempt.
// On success returns { url, pathname, contentType, assetId }.
// On user-cancel via abortSignal: throws an AbortError; the IndexedDB record
// is left in place so the user can resume later.
export async function startResumableUpload(file, meta, { abortSignal, onProgress } = {}) {
  if (!file) throw new Error('file required')

  // 1. Reserve the upload server-side.
  const created = await api('/api/media/multipart/create', {
    method: 'POST',
    body: JSON.stringify({
      contentType: file.type || 'application/octet-stream',
      filename: file.name,
      fileSize: file.size,
      meta: {
        createdBy: meta.createdBy || null,
        patientPseudonym: meta.patientPseudonym || null,
        condition: meta.condition || null,
        capturedAt: meta.capturedAt || null,
        notes: meta.notes || null,
        assetPurpose: meta.assetPurpose || null,
        speakerRole: meta.assetPurpose === 'interview' ? (meta.speakerRole || 'clinician') : null,
        parentId: meta.parentId || null,
        contentPieceId: meta.contentPieceId || null,
        collectionId: meta.collectionId || null,
        staffId: meta.staffId || null,
      },
    }),
  })

  const partSize = pickPartSize(file.size)
  const id = (typeof crypto !== 'undefined' && crypto.randomUUID)
    ? crypto.randomUUID()
    : `up-${Date.now()}-${Math.random().toString(36).slice(2)}`

  const record = {
    id,
    status: 'pending',
    pathname: created.pathname,
    contentType: created.contentType,
    uploadId: created.uploadId,
    key: created.key,
    clientToken: created.clientToken,
    tokenExpiresAt: created.tokenExpiresAt,
    filename: file.name,
    fileSize: file.size,
    fileType: file.type,
    fileLastModified: file.lastModified,
    fileBlob: file,
    partSize,
    completedParts: [],
    tokenPayloadServer: created.tokenPayloadServer,
    meta: {
      assetPurpose: meta.assetPurpose || null,
      collectionId: meta.collectionId || null,
    },
    workspaceHost: typeof location !== 'undefined' ? location.host : null,
    suggestedPathname: buildSuggestedPathname(file, meta),
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }
  await putUpload(record).catch((e) => {
    // IDB write failure isn't fatal — the upload can still complete, just
    // without cross-reload resume. Surface in console so we notice if a
    // browser is broken.
    console.warn('[resumableUpload] IDB write failed, resume will be unavailable:', e?.message)
  })

  return runUploadFromRecord(record, file, { abortSignal, onProgress })
}

// Resume an upload from a hydrated IndexedDB record. Used by Resume button
// in the upload tray. Validates the cached File against the record's
// fileLastModified before re-using it.
export async function resumePersistedUpload(id, { abortSignal, onProgress } = {}) {
  const record = await getUpload(id)
  if (!record) throw new Error('Upload not found')

  if (record.tokenExpiresAt && record.tokenExpiresAt < Date.now() + 60_000) {
    await deleteUpload(id).catch(() => {})
    throw new Error('Upload token expired. Please start over.')
  }

  const file = record.fileBlob
  if (!file || !(file instanceof Blob)) {
    await deleteUpload(id).catch(() => {})
    throw new Error('Original file no longer available. Please start over.')
  }
  if (file.size !== record.fileSize) {
    await deleteUpload(id).catch(() => {})
    throw new Error('File size changed since last attempt. Please start over.')
  }
  if (file.lastModified && record.fileLastModified && file.lastModified !== record.fileLastModified) {
    await deleteUpload(id).catch(() => {})
    throw new Error('File was modified since last attempt. Please start over.')
  }

  return runUploadFromRecord(record, file, { abortSignal, onProgress })
}

// Core loop. Walks the part queue, uploads missing parts in parallel, persists
// after every successful part, then calls /complete.
async function runUploadFromRecord(record, file, { abortSignal, onProgress }) {
  const { partSize, fileSize } = record
  const partCount = totalParts(fileSize, partSize)
  const completed = new Map(
    (record.completedParts || []).map((p) => [p.partNumber, p]),
  )
  const tracker = makeProgressTracker(record.completedParts, fileSize, onProgress)
  tracker.seedCompleted(record.completedParts || [], partSize, partCount)

  const pending = []
  for (let i = 1; i <= partCount; i++) {
    if (!completed.has(i)) pending.push(i)
  }

  await runWithConcurrency(pending, PART_CONCURRENCY, async (partNumber) => {
    if (abortSignal?.aborted) throw new DOMException('aborted', 'AbortError')

    const start = (partNumber - 1) * partSize
    const end   = Math.min(start + partSize, fileSize)
    const blob  = file.slice(start, end)

    const result = await uploadPart(record.pathname, blob, {
      access: 'public',
      token: record.clientToken,
      uploadId: record.uploadId,
      key: record.key,
      partNumber,
      contentType: record.contentType,
      abortSignal,
      onUploadProgress: ({ loaded }) => {
        tracker.setPartLive(partNumber, loaded)
      },
    })

    const partEntry = { partNumber: result.partNumber, etag: result.etag }
    completed.set(partNumber, partEntry)
    tracker.markPartDone(partNumber, end - start)

    // Persist after each part. The completedParts array is the resumable
    // state of truth — even if the next part errors, the previous part's
    // etag is durably recorded.
    await patchUpload(record.id, {
      completedParts: Array.from(completed.values()).sort((a, b) => a.partNumber - b.partNumber),
    }).catch((e) => console.warn('[resumableUpload] IDB patch failed:', e?.message))
  }, abortSignal)

  const sortedParts = Array.from(completed.values()).sort((a, b) => a.partNumber - b.partNumber)

  const completion = await api('/api/media/multipart/complete', {
    method: 'POST',
    body: JSON.stringify({
      uploadId: record.uploadId,
      key: record.key,
      pathname: record.pathname,
      contentType: record.contentType,
      parts: sortedParts,
      totalSize: fileSize,
      tokenPayloadServer: record.tokenPayloadServer,
    }),
  })

  // Clean up the IDB record on success; the asset row is now in the DB.
  await deleteUpload(record.id).catch(() => {})

  return {
    id: record.id,
    url: completion.url,
    pathname: completion.pathname,
    contentType: completion.contentType,
    assetId: completion.assetId,
  }
}

// Best-effort cancel. Hits /multipart/abort (no-op on current SDK but kept
// for forward-compat) and deletes the IDB record. Caller is responsible for
// also aborting any in-flight AbortController.
export async function abortPersistedUpload(id) {
  const record = await getUpload(id).catch(() => null)
  if (record) {
    try {
      await api('/api/media/multipart/abort', {
        method: 'POST',
        body: JSON.stringify({
          uploadId: record.uploadId,
          key: record.key,
          pathname: record.pathname,
        }),
      })
    } catch { /* best-effort */ }
  }
  await deleteUpload(id).catch(() => {})
}

// Hydrate paused uploads from IDB for surfacing in the tray. Returns rows
// shaped so UploadProgressProvider can render them next to in-flight rows
// without a parallel code path.
export async function listPausedUploads() {
  const { listUploads } = await import('@/lib/uploadDb')
  const all = await listUploads().catch(() => [])
  const now = Date.now()
  return all
    .filter((r) => r.status === 'pending')
    .filter((r) => !r.tokenExpiresAt || r.tokenExpiresAt > now + 60_000)
    .filter((r) => r.fileBlob && r.fileBlob.size === r.fileSize)
    .sort((a, b) => b.createdAt - a.createdAt)
}
