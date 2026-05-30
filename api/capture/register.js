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
import { recordUploadedAsset } from '../_lib/recordUploadedAsset.js'

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
  const expectedPrefix = `media/capture/${auth.workspace.id}/`
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

  const capturedAtIso = capturedAt
    ? new Date(capturedAt).toISOString()
    : new Date().toISOString()

  // The Shortcut sends a generic "capture.mov" for every file type — even
  // photos, which come with contentType=image/jpeg but filename=capture.mov.
  // Derive the extension from the MIME type so photos don't end up labeled .mov.
  const MIME_EXT = {
    'image/jpeg': 'jpg', 'image/png': 'png', 'image/heic': 'heic',
    'image/heif': 'heif', 'image/webp': 'webp', 'image/gif': 'gif',
    'video/mp4': 'mp4', 'video/quicktime': 'mov',
    'video/webm': 'webm', 'video/x-m4v': 'm4v',
  }
  let displayFilename = filename
  if (/^capture\.(mov|mp4|m4v|webm|jpg|jpeg|png|heic|heif|webp|gif)$/i.test(filename)) {
    const ext = MIME_EXT[contentType] || filename.split('.').pop().toLowerCase()
    const stamp = capturedAtIso.slice(0, 16).replace('T', ' ').replace(':', '-')
    displayFilename = `Capture ${stamp}.${ext}`
  }
  const safeFilename = displayFilename.replace(/[^\w.\- ]/g, '_')

  // Delegate to the canonical upload pipeline so capture uploads get the exact
  // same downstream treatment as the web uploader: thumbnail generation, Mux
  // transcode, dimension/faststart probes, AI tagging, and visual-memory index.
  // Previously register did a bare insert (no thumbnail/transcode), which is why
  // capture clips showed as a generic tile with no poster frame.
  const asset = await recordUploadedAsset({
    blob: {
      url: publicUrl,
      pathname: blobPathname,
      contentType,
      size: typeof sizeBytes === 'number' ? sizeBytes : null,
    },
    tokenPayload: {
      scopeColumn: 'workspace_id',
      scopeId: auth.workspace.id,
      source: 'capture_companion',
      staffId: auth.staffMember.id,
      filename: safeFilename,
      capturedAt: capturedAtIso,
      notes: caption || null,
      createdBy: auth.staffMember.user_id || null,
      // asset_purpose is CHECK-constrained to interview|broll|photo|brand.
      assetPurpose: kind === 'video' ? 'broll' : 'photo',
    },
  })

  if (!asset?.id) {
    console.error('[capture/register] recordUploadedAsset returned no row')
    return res.status(500).json({ error: 'db_error' })
  }

  // Tag the location hint after insert (recordUploadedAsset doesn't take tags).
  if (locationHint) {
    waitUntil(
      sb(`media_assets?id=eq.${asset.id}&workspace_id=eq.${auth.workspace.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ tags: [locationHint] }),
      }).catch(() => {}),
    )
  }

  // Update token last-used (best effort)
  waitUntil(
    sb(`staff?id=eq.${auth.staffMember.id}&workspace_id=eq.${auth.workspace.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ capture_upload_token_last_used_at: new Date().toISOString() }),
    }).catch(() => {}),
  )

  return res.status(201).json({
    assetId: asset.id,
    publicUrl,
    status: 'uploaded',
    kind,
  })
}
