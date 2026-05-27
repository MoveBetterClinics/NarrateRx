// Client-side helpers for the Media Hub. Uploads use @vercel/blob/client which
// hits /api/media/upload for a token, then PUTs the file directly to Vercel
// Blob. Server-side completion writes the media_assets row.
//
// Every request to /api/media/* carries a short-lived Clerk JWT in the
// Authorization header. Server-side requireRole() verifies it and enforces
// per-method roles. window.Clerk is the official browser handle exposed by
// @clerk/react; we read the token off the active session here so each
// caller doesn't have to thread getToken through props or context.

import { upload } from '@vercel/blob/client'
import { throwApiError } from '@/lib/apiError'

async function getClerkToken() {
  if (typeof window === 'undefined') return null
  try {
    return await window.Clerk?.session?.getToken?.()
  } catch {
    return null
  }
}

async function api(path, init = {}) {
  const token   = await getClerkToken()
  const headers = { ...(init.headers || {}) }
  if (token) headers.Authorization = `Bearer ${token}`
  const res  = await fetch(path, { ...init, headers })
  if (!res.ok) {
    // Reconstruct a Response so throwApiError can read the body + headers.
    const text = await res.text().catch(() => '')
    await throwApiError(new Response(text, { status: res.status, headers: res.headers }))
  }
  return await res.json().catch(() => ({}))
}

// ── List & detail ────────────────────────────────────────────────────────────

export function listMedia({ kind, status, q, tag, purpose, collectionId, limit, offset, compact, sources } = {}) {
  const params = new URLSearchParams()
  if (kind)         params.set('kind', kind)
  if (status)       params.set('status', status)
  if (q)            params.set('q', q)
  if (tag)          params.set('tag', tag)
  if (purpose)      params.set('purpose', purpose)
  if (collectionId) params.set('collectionId', collectionId)
  if (limit)        params.set('limit', String(limit))
  if (offset)       params.set('offset', String(offset))
  if (compact)      params.set('compact', 'true')
  if (sources)      params.set('sources', 'true')
  const qs = params.toString()
  return api(`/api/media/list${qs ? `?${qs}` : ''}`)
}

export function getMediaAsset(id) {
  return api(`/api/media/${encodeURIComponent(id)}`)
}

export function updateMediaAsset(id, patch) {
  return api(`/api/media/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  })
}

// Soft-delete (archive). Sets status='archived' + archived_at=now() server-side.
// The asset is hidden from the default list view but remains in storage and is
// restorable forever via restoreMediaAsset(). Hard delete is purgeMediaAsset()
// — admin-only, ≥30-day cooldown.
export function archiveMediaAsset(id) {
  return api(`/api/media/${encodeURIComponent(id)}`, { method: 'DELETE' })
}

// Move an archived asset back to active library. Server clears archived_at and
// audits action='restore'.
export function restoreMediaAsset(id, status = 'raw') {
  return api(`/api/media/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status }),
  })
}

// Permanently delete an archived asset — admin-only, requires the asset to
// have been archived for at least 30 days. Caller must echo back the exact
// filename in `confirmFilename` as a typed-confirm safeguard.
export function purgeMediaAsset(id, confirmFilename) {
  return api(`/api/media/${encodeURIComponent(id)}/purge`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ confirmFilename }),
  })
}

// Trigger AI auto-tagging for an asset (vision + transcription for video).
// Synchronous on the server — caller should expect 10–60s for video clips.
export function tagMediaAsset(id) {
  return api(`/api/media/tag`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id }),
  })
}

// Edit a media asset: rotate (0/90/180/270) and/or crop (in post-rotation
// pixel space). Default mode 'variant' creates a new media_assets row with
// parent_id set to this asset's id. Mode 'replace-master' overwrites the
// source blob in place (only valid when the source is itself a master, i.e.
// parent_id IS NULL on the row) — used for "fix the original" rotations.
//
// params:
//   rotate  — 0 | 90 | 180 | 270
//   crop    — { x, y, w, h } in pixels of the post-rotation frame, or null
//   label   — optional variant_label ("9:16 Reel" etc.). Auto-generated from
//             the final aspect ratio if omitted.
//   mode    — 'variant' (default) | 'replace-master'
//
// Returns: { mode, asset } — `asset` is the new variant row (variant mode) or
// the updated master row (replace-master mode).
export function editMediaAsset(id, { rotate = 0, crop = null, label = null, mode = 'variant' } = {}) {
  return api(`/api/media/${encodeURIComponent(id)}/edit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rotate, crop, label, mode }),
  })
}

// List variants derived from a given source asset id. Wraps listMedia with the
// `parent` filter so the variant strip in MediaDetail doesn't have to know the
// query-param name. Includes archived rows excluded by default.
export function listVariants(parentId) {
  return api(`/api/media/list?parent=${encodeURIComponent(parentId)}`)
}

// Resolve the "family" of an asset — the master + all its rotate/crop
// variants — given the id of any family member. Used by the post-composer
// variant picker, which needs to offer swap targets regardless of which
// family member was originally attached. Returns:
//   { master, variants: [...] }
// where `master` is the parent_id root and `variants` includes only rows with
// a variant_label (filters out unrelated parent_id children like CapCut
// returns).
export async function getAssetFamily(id) {
  const self = await getMediaAsset(id)
  if (!self) return { master: null, variants: [] }
  const masterId = self.parent_id || self.id
  const master = self.parent_id ? await getMediaAsset(masterId) : self
  const siblings = await api(`/api/media/list?parent=${encodeURIComponent(masterId)}`)
  const variants = (siblings || []).filter((r) => r.variant_label)
  return { master, variants }
}

// (Re)generate a poster-frame thumbnail for a video. New uploads get one
// automatically via the upload pipeline; this is for backfilling older
// videos or redoing a frame that landed on a black flash.
export function regenerateThumbnail(id) {
  return api(`/api/media/${encodeURIComponent(id)}/thumbnail`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  })
}

// Admin-only batch backfill: scans this workspace for videos missing thumbnails
// and processes up to `limit` of them sequentially. Re-run until processed=0.
export function backfillThumbnails(limit = 25) {
  return api(`/api/media/backfill-thumbnails`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ limit }),
  })
}

// ── Upload ────────────────────────────────────────────────────────────────────

// iPhone-shot HEIC/HEIF can't be rendered by browsers and isn't accepted by
// most vision models. We transcode to JPEG client-side before upload so the
// canonical blob is always a format every downstream consumer (workbench
// preview, AI Gateway, segmenter) handles natively. heic2any pulls in a
// libheif WASM bundle (~3 MB) and runs CPU-heavy decode + re-encode — kept
// off the main thread via a Worker so the UI stays responsive during the
// transcode. The Worker bundle is its own dynamic chunk; cost is paid only
// when a HEIC is actually selected.
function isHeicFile(file) {
  const name = (file.name || '').toLowerCase()
  const type = (file.type || '').toLowerCase()
  return type === 'image/heic' || type === 'image/heif'
      || name.endsWith('.heic') || name.endsWith('.heif')
}

async function transcodeViaWorker(file) {
  // Vite's `?worker` query generates a dedicated chunk + a Worker
  // constructor. Dynamic import keeps the Worker bundle (which pulls in
  // heic2any + libheif WASM) out of the main bundle.
  const { default: HeicWorker } = await import('./heicWorker.js?worker')
  const worker = new HeicWorker()
  try {
    return await new Promise((resolve, reject) => {
      worker.onmessage = (e) => {
        if (e.data?.ok) resolve(e.data.blob)
        else reject(new Error(e.data?.error || 'Transcode failed'))
      }
      worker.onerror = (e) => reject(new Error(e.message || 'Worker error'))
      worker.postMessage({ blob: file, quality: 0.92 })
    })
  } finally {
    // Workers are one-shot from our side; terminating frees the wasm
    // module + decoder state. Browsers cache the underlying source so the
    // next HEIC re-instantiates instantly.
    worker.terminate()
  }
}

async function maybeTranscodeHeic(file) {
  if (!isHeicFile(file)) return file
  try {
    const jpeg = await transcodeViaWorker(file)
    const newName = file.name.replace(/\.(heic|heif)$/i, '.jpg')
    return new File([jpeg], newName, { type: 'image/jpeg', lastModified: file.lastModified })
  } catch (e) {
    // heic2any 0.0.4's bundled libheif WASM rejects some HEIC variants
    // (Live Photo sequences, certain HEVC profiles, anything iCloud has
    // re-encoded with newer codecs) with errors like 'ERR_LIBHEIF format
    // not supported'. Rather than fail the upload, hand the raw HEIC to
    // the server: api/media/upload.js accepts image/heic + image/heif,
    // and the server's image pipeline (api/_lib/imagePipeline.js) decodes
    // them with sharp's libheif binding — which is a much newer libvips
    // build and routinely handles formats heic2any chokes on.
    //
    // The resulting media_assets row still ends up with a JPEG web
    // variant + AI alt text, indistinguishable from the client-transcode
    // path. Original HEIC stays in original_blob_url.
    console.warn('[heic] client transcode failed, falling back to server-side conversion:', e?.message)
    // Re-stamp the mime so the upload handshake's content-type matches
    // the file's true format — some browsers fill .heic files with
    // empty/octet-stream mime, which would otherwise fall through the
    // server's ALLOWED_MIME check.
    const declaredType = file.type || 'image/heic'
    const heicType = /heic|heif/i.test(declaredType) ? declaredType : 'image/heic'
    return new File([file], file.name, { type: heicType, lastModified: file.lastModified })
  }
}

// Direct-to-Blob upload. The handleUpload endpoint records the asset on
// completion. We pass metadata via clientPayload so the server sees who/what
// the file is for without making the browser trust-record it.
//
// meta keys (all optional):
//   createdBy, patientPseudonym, condition, capturedAt, notes,
//   assetPurpose      — 'interview' | 'broll' | 'photo' | 'brand'.
//                       Drives the AI pipeline branch on the server; if
//                       omitted, server falls back to kind-based default.
//   speakerRole       — 'clinician' | 'admin' | 'patient_guest'. Only set
//                       when assetPurpose === 'interview'.
//   parentId          — when set, this is a return-upload of a finished edit;
//                       server inserts with parent_id set, status='approved',
//                       and skips the AI auto-pipeline.
//   contentPieceId    — paired with parentId; server marks the brief as
//                       'returned' and links its final_asset_id.
export async function uploadMedia(file, meta = {}, options = {}) {
  // HEIC transcode happens before the upload begins, so it's separate from
  // the upload progress curve. Callers that want a UI signal during transcode
  // can pass options.onTranscodeStart / onTranscodeEnd; we keep both optional
  // so existing call sites stay unchanged.
  if (typeof options.onTranscodeStart === 'function' && isHeicFile(file)) {
    options.onTranscodeStart()
  }
  file = await maybeTranscodeHeic(file)
  options.onTranscodeEnd?.()

  const ext       = (file.name.match(/\.[^.]+$/) || [''])[0]
  const baseName  = file.name.replace(/\.[^.]+$/, '').replace(/[^a-z0-9-_]+/gi, '-').toLowerCase()
  const stamp     = new Date().toISOString().replace(/[:.]/g, '-')
  const folder    = meta.parentId ? 'media/edited' : 'media/raw'
  const pathname  = `${folder}/${stamp}-${baseName}${ext}`

  const token = await getClerkToken()

  const blob = await upload(pathname, file, {
    access: 'public',  // private blobs require additional plan + signed URL routing
    handleUploadUrl: '/api/media/upload',
    contentType: file.type || undefined,
    // Forward Clerk JWT on the handshake to /api/media/upload. The completion
    // webhook (Vercel Blob → server) is signature-verified by handleUpload
    // and doesn't need a user token.
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    // @vercel/blob exposes determinate progress via onUploadProgress. Event
    // shape: { loaded, total, percentage }. We forward it directly so the
    // caller can render an actual progress bar instead of an opaque spinner.
    onUploadProgress: typeof options.onProgress === 'function'
      ? (e) => options.onProgress(e)
      : undefined,
    clientPayload: JSON.stringify({
      filename: file.name,
      createdBy: meta.createdBy || null,
      patientPseudonym: meta.patientPseudonym || null,
      condition: meta.condition || null,
      capturedAt: meta.capturedAt || null,
      notes: meta.notes || null,
      assetPurpose: meta.assetPurpose || null,
      speakerRole: meta.assetPurpose === 'interview' ? (meta.speakerRole || 'clinician') : null,
      parentId: meta.parentId || null,
      contentPieceId: meta.contentPieceId || null,
      // Optional pre-assigned collection. Server verifies scope before
      // inserting into collection_items.
      collectionId: meta.collectionId || null,
      // Optional clinician attribution. Server validates clinician belongs to
      // the workspace before writing clinician_id on the asset row.
      clinicianId: meta.clinicianId || null,
    }),
  })

  // The asset row is created server-side in onUploadCompleted. The Blob URL
  // is the join key — list will return the new row once Blob fires the
  // completion webhook. Caller should refetch the list.
  return blob
}
