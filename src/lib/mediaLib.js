// Client-side helpers for the Media Hub. Uploads use @vercel/blob/client which
// hits /api/media/upload for a token, then PUTs the file directly to Vercel
// Blob. Server-side completion writes the media_assets row.

import { upload } from '@vercel/blob/client'

async function api(path, init = {}) {
  const res = await fetch(path, init)
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(json.error || `Request failed: ${res.status}`)
  return json
}

// ── List & detail ────────────────────────────────────────────────────────────

export function listMedia({ kind, status, q, tag, limit, offset } = {}) {
  const params = new URLSearchParams()
  if (kind)   params.set('kind', kind)
  if (status) params.set('status', status)
  if (q)      params.set('q', q)
  if (tag)    params.set('tag', tag)
  if (limit)  params.set('limit', String(limit))
  if (offset) params.set('offset', String(offset))
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

export function deleteMediaAsset(id) {
  return api(`/api/media/${encodeURIComponent(id)}`, { method: 'DELETE' })
}

// ── Upload ────────────────────────────────────────────────────────────────────

// Direct-to-Blob upload. The handleUpload endpoint records the asset on
// completion. We pass metadata via clientPayload so the server sees who/what
// the file is for without making the browser trust-record it.
export async function uploadMedia(file, meta = {}) {
  const ext       = (file.name.match(/\.[^.]+$/) || [''])[0]
  const baseName  = file.name.replace(/\.[^.]+$/, '').replace(/[^a-z0-9-_]+/gi, '-').toLowerCase()
  const stamp     = new Date().toISOString().replace(/[:.]/g, '-')
  const pathname  = `media/raw/${stamp}-${baseName}${ext}`

  const blob = await upload(pathname, file, {
    access: 'public',  // private blobs require additional plan + signed URL routing
    handleUploadUrl: '/api/media/upload',
    contentType: file.type || undefined,
    clientPayload: JSON.stringify({
      filename: file.name,
      createdBy: meta.createdBy || null,
      patientPseudonym: meta.patientPseudonym || null,
      condition: meta.condition || null,
      capturedAt: meta.capturedAt || null,
      notes: meta.notes || null,
    }),
  })

  // The asset row is created server-side in onUploadCompleted. The Blob URL
  // is the join key — list will return the new row once Blob fires the
  // completion webhook. Caller should refetch the list.
  return blob
}
