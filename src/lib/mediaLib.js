// Client-side helpers for the Media Hub. Uploads use @vercel/blob/client which
// hits /api/media/upload for a token, then PUTs the file directly to Vercel
// Blob. Server-side completion writes the media_assets row.
//
// Every request to /api/media/* carries a short-lived Clerk JWT in the
// Authorization header. Server-side requireRole() verifies it and enforces
// per-method roles. window.Clerk is the official browser handle exposed by
// @clerk/clerk-react; we read the token off the active session here so each
// caller doesn't have to thread getToken through props or context.

import { upload } from '@vercel/blob/client'

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

// ── Upload ────────────────────────────────────────────────────────────────────

// Direct-to-Blob upload. The handleUpload endpoint records the asset on
// completion. We pass metadata via clientPayload so the server sees who/what
// the file is for without making the browser trust-record it.
export async function uploadMedia(file, meta = {}) {
  const ext       = (file.name.match(/\.[^.]+$/) || [''])[0]
  const baseName  = file.name.replace(/\.[^.]+$/, '').replace(/[^a-z0-9-_]+/gi, '-').toLowerCase()
  const stamp     = new Date().toISOString().replace(/[:.]/g, '-')
  const pathname  = `media/raw/${stamp}-${baseName}${ext}`

  const token = await getClerkToken()

  const blob = await upload(pathname, file, {
    access: 'public',  // private blobs require additional plan + signed URL routing
    handleUploadUrl: '/api/media/upload',
    contentType: file.type || undefined,
    // Forward Clerk JWT on the handshake to /api/media/upload. The completion
    // webhook (Vercel Blob → server) is signature-verified by handleUpload
    // and doesn't need a user token.
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
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
