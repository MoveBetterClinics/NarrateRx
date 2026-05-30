// POST /api/capture/register
//
// Step 3 of the iOS Shortcut large-file upload flow.
// Called after the Shortcut has PUT the video directly to Vercel Blob.
// Creates the media_assets row and kicks off the visual memory index.
//
// Auth: Bearer <capture_upload_token>.
//
// Request body (JSON):
//   blobPathname  — required, from /api/capture/upload-url response
//   filename      — required, original filename
//   contentType   — required, e.g. "video/quicktime"
//   sizeBytes     — optional (Shortcuts may not know exact size beforehand)
//   capturedAt    — ISO timestamp when the moment happened (iPhone local time)
//   locationHint  — optional free-text room/area label
//   caption       — optional quick note from the clinician
//
// Response 201: { assetId, publicUrl, status: 'uploaded', kind }

export const config = { runtime: 'nodejs' }

import { waitUntil } from '@vercel/functions'
import { authByCaptureToken } from '../_lib/captureAuth.js'
import { indexMediaAsset } from '../_lib/visualMemoryIndex.js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY

const ALLOWED_IMAGE_MIME = new Set([
  'image/jpeg', 'image/png', 'image/heic', 'image/heif', 'image/webp', 'image/gif',
])
const ALLOWED_VIDEO_MIME = new Set([
  'video/mp4', 'video/quicktime', 'video/webm', 'video/x-m4v',
])

async function sb(path, init = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
      ...init.headers,
    },
  })
}

function kindFromMime(mime) {
  if (ALLOWED_IMAGE_MIME.has(mime)) return 'photo'
  if (ALLOWED_VIDEO_MIME.has(mime)) return 'video'
  return null
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'method_not_allowed' })
  }

  const authHeader = req.headers['authorization'] || ''
  const m = authHeader.match(/^Bearer\s+(.+)$/i)
  if (!m) return res.status(401).json({ error: 'missing_bearer' })

  const auth = await authByCaptureToken(m[1].trim())
  if (!auth) return res.status(401).json({ error: 'invalid_or_expired_token' })

  const { blobPathname, filename, contentType, sizeBytes, capturedAt, locationHint, caption } =
    req.body || {}

  if (!blobPathname || !filename || !contentType) {
    return res.status(400).json({ error: 'blobPathname, filename, and contentType are required' })
  }

  const kind = kindFromMime(contentType)
  if (!kind) {
    return res.status(415).json({ error: 'unsupported_media_type', contentType })
  }

  // Validate the blobPathname belongs to this workspace to prevent cross-workspace
  // registration of another workspace's uploaded blob.
  const expectedPrefix = `media/capture/${auth.workspace.slug}/`
  if (!blobPathname.startsWith(expectedPrefix)) {
    return res.status(403).json({ error: 'pathname_workspace_mismatch' })
  }

  const storeId = (process.env.BLOB_READ_WRITE_TOKEN || '').split('_')[3] || ''
  const publicUrl = storeId
    ? `https://${storeId}.public.blob.vercel-storage.com/${blobPathname}`
    : null

  if (!publicUrl) {
    console.error('[capture/register] could not derive publicUrl — BLOB_READ_WRITE_TOKEN missing or malformed')
    return res.status(500).json({ error: 'blob_url_construction_failed' })
  }

  const safeFilename = filename.replace(/[^\w.-]/g, '_')
  const capturedAtIso = capturedAt
    ? new Date(capturedAt).toISOString()
    : new Date().toISOString()

  const insertRes = await sb('media_assets', {
    method: 'POST',
    body: JSON.stringify({
      workspace_id: auth.workspace.id,
      staff_id: auth.staffMember.id,
      kind,
      status: 'raw',
      source: 'capture_companion',
      blob_url: publicUrl,
      blob_pathname: blobPathname,
      original_blob_url: publicUrl,
      filename: safeFilename,
      mime_type: contentType,
      size_bytes: typeof sizeBytes === 'number' ? sizeBytes : null,
      captured_at: capturedAtIso,
      // asset_purpose is CHECK-constrained to interview|broll|photo|brand.
      // Video field-capture maps to broll; photos to photo.
      asset_purpose: kind === 'video' ? 'broll' : 'photo',
      notes: caption || null,
      tags: locationHint ? [locationHint] : [],
      created_by: auth.staffMember.user_id || null,
    }),
  })

  if (!insertRes.ok) {
    const body = await insertRes.text().catch(() => '')
    console.error('[capture/register] insert_media_asset failed:', insertRes.status, body)
    return res.status(500).json({ error: 'db_error' })
  }

  const rows = await insertRes.json()
  const asset = rows?.[0]
  if (!asset?.id) return res.status(500).json({ error: 'insert_returned_no_row' })

  // Update token last-used (best effort)
  waitUntil(
    sb(`staff?id=eq.${auth.staffMember.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ capture_upload_token_last_used_at: new Date().toISOString() }),
    }).catch(() => {}),
  )

  // Visual memory index (async)
  waitUntil(
    indexMediaAsset({ assetId: asset.id }).catch((e) => {
      console.error('[capture/register] visualMemoryIndex failed:', e?.message)
    }),
  )

  return res.status(201).json({
    assetId: asset.id,
    publicUrl,
    status: 'uploaded',
    kind,
  })
}
