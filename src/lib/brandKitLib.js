// Client-side helpers for the Brand Kit feature. Mirrors src/lib/mediaLib.js
// in shape — Clerk JWT on every request, direct-to-Blob upload via the
// two-phase handshake at /api/brand-kit/upload, plain JSON CRUD for the rest.
//
// The Brand Kit lives in its own table (brand_assets) with its own role-slot
// mapping (brand_kit_roles), so this file is separate from mediaLib.js even
// though the upload plumbing is similar — keeping the two libraries apart
// means the Media Hub UI can evolve without dragging Brand Kit semantics
// along (kinds, speaker roles, AI tagging, etc.).

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
    const text = await res.text().catch(() => '')
    await throwApiError(new Response(text, { status: res.status, headers: res.headers }))
  }
  return await res.json().catch(() => ({}))
}

// ── Read ────────────────────────────────────────────────────────────────────

// Combined fetch — returns { assets, roles, style } in one round-trip. The
// component reads all three together; collapsing to one call avoids the
// loading cascade we'd otherwise see from three separate fetches.
export function getBrandKit() {
  return api('/api/brand-kit/list')
}

// ── Asset mutations ─────────────────────────────────────────────────────────

export function updateBrandAsset(id, patch) {
  return api(`/api/brand-kit/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  })
}

export function deleteBrandAsset(id) {
  return api(`/api/brand-kit/${encodeURIComponent(id)}`, { method: 'DELETE' })
}

// ── Role mutations ──────────────────────────────────────────────────────────

export function assignBrandRole(role, assetId) {
  return api(`/api/brand-kit/roles/${encodeURIComponent(role)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ assetId }),
  })
}

export function clearBrandRole(role) {
  return api(`/api/brand-kit/roles/${encodeURIComponent(role)}`, { method: 'DELETE' })
}

// ── Style mutation ──────────────────────────────────────────────────────────

export function updateBrandStyle(patch) {
  return api('/api/brand-kit/style', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  })
}

// ── Upload ──────────────────────────────────────────────────────────────────

const ALLOWED_BRAND_MIME = new Set([
  'image/svg+xml', 'image/png', 'image/jpeg', 'image/webp', 'application/pdf',
])

// Extension → MIME fallback for files whose browser-reported type is empty.
// This commonly happens when files come from a folder drop — the OS/browser
// occasionally strips the type for files inside a dragged directory.
const EXT_MIME = {
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.pdf': 'application/pdf',
}

function resolveContentType(file) {
  if (file.type) return file.type
  const ext = (file.name.match(/\.[^.]+$/) || [''])[0].toLowerCase()
  return EXT_MIME[ext] || null
}

// Direct-to-Blob upload. The handshake endpoint mints a token; @vercel/blob
// then PUTs the file straight to Blob storage; the platform calls back into
// /api/brand-kit/upload which writes the brand_assets row.
//
// Returns the @vercel/blob `Blob` object on success; the caller refetches the
// kit (getBrandKit) to see the new asset row appear.
export async function uploadBrandAsset(file, meta = {}, options = {}) {
  const contentType = resolveContentType(file)
  if (!contentType || !ALLOWED_BRAND_MIME.has(contentType)) {
    throw new Error(
      contentType
        ? `Unsupported file type for brand assets: ${contentType}`
        : `Cannot determine file type for "${file.name}" — use SVG, PNG, JPG, WebP, or PDF`
    )
  }

  const ext       = (file.name.match(/\.[^.]+$/) || [''])[0]
  const baseName  = file.name.replace(/\.[^.]+$/, '').replace(/[^a-z0-9-_]+/gi, '-').toLowerCase()
  const stamp     = new Date().toISOString().replace(/[:.]/g, '-')
  const pathname  = `brand-assets/${stamp}-${baseName}${ext}`

  const token = await getClerkToken()

  return await upload(pathname, file, {
    access: 'public',
    handleUploadUrl: '/api/brand-kit/upload',
    contentType,
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    onUploadProgress: typeof options.onProgress === 'function'
      ? (e) => options.onProgress(e)
      : undefined,
    clientPayload: JSON.stringify({
      filename: file.name,
      uploadedBy: meta.uploadedBy || null,
      fileSize: file.size || null,
    }),
  })
}
