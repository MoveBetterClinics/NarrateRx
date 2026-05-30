// POST /api/capture/upload-url
//
// Step 1 of the iOS Shortcut large-file upload flow.
// Issues a Vercel Blob client token for a specific pathname so the Shortcut
// can PUT the video file directly to Vercel Blob — bypassing the API function
// entirely for the actual bytes. Works for any file size.
//
// Auth: Bearer <capture_upload_token> (same as /api/capture/upload).
//
// Request body (JSON): { filename, contentType }
//
// Response 200:
//   uploadUrl   — PUT target: https://vercel.com/api/blob?pathname=…
//   clientToken — Bearer token for the PUT (one-time, pathname-scoped)
//   blobPathname — pass this to /api/capture/register after upload completes
//   publicUrl   — the CDN URL the file will be readable at after PUT
//
// The Shortcut flow:
//   1. POST here → get { uploadUrl, clientToken, blobPathname, publicUrl }
//   2. PUT <uploadUrl> with body=video, Authorization: Bearer <clientToken>,
//      x-api-version: 12, x-vercel-blob-access: public, x-content-type: <mime>
//   3. POST /api/capture/register with { blobPathname, filename, contentType, capturedAt, ... }

export const config = { runtime: 'nodejs' }

import { generateClientTokenFromReadWriteToken } from '@vercel/blob/client'
import { authByCaptureToken } from '../_lib/captureAuth.js'

const ALLOWED_MIME = new Set([
  'image/jpeg', 'image/png', 'image/heic', 'image/heif', 'image/webp', 'image/gif',
  'video/mp4', 'video/quicktime', 'video/webm', 'video/x-m4v',
])

const MAX_UPLOAD_BYTES = 2 * 1024 * 1024 * 1024 // 2 GB — the Vercel Blob hard limit

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'method_not_allowed' })
  }

  const authHeader = req.headers['authorization'] || ''
  const m = authHeader.match(/^Bearer\s+(.+)$/i)
  if (!m) return res.status(401).json({ error: 'missing_bearer' })

  const auth = await authByCaptureToken(m[1].trim())
  if (!auth) return res.status(401).json({ error: 'invalid_or_expired_token' })

  const { filename, contentType } = req.body || {}
  if (!filename || !contentType) {
    return res.status(400).json({ error: 'filename and contentType are required' })
  }
  if (!ALLOWED_MIME.has(contentType)) {
    return res.status(415).json({ error: 'unsupported_media_type', contentType })
  }

  const safeFilename = filename.replace(/[^\w.-]/g, '_')
  const blobPathname = `media/capture/${auth.workspace.slug}/${Date.now()}-${safeFilename}`

  // Extract store ID from RW token (format: vercel_blob_rw_STOREID_SECRET)
  const storeId = (process.env.BLOB_READ_WRITE_TOKEN || '').split('_')[3] || ''

  let clientToken
  try {
    clientToken = await generateClientTokenFromReadWriteToken({
      pathname: blobPathname,
      allowedContentTypes: [contentType],
      maximumSizeInBytes: MAX_UPLOAD_BYTES,
      token: process.env.BLOB_READ_WRITE_TOKEN,
    })
  } catch (e) {
    console.error('[capture/upload-url] token generation failed:', e?.message)
    return res.status(500).json({ error: 'token_generation_failed' })
  }

  const uploadUrl = `https://vercel.com/api/blob?pathname=${encodeURIComponent(blobPathname)}`
  const publicUrl = storeId
    ? `https://${storeId}.public.blob.vercel-storage.com/${blobPathname}`
    : null

  return res.status(200).json({
    uploadUrl,
    clientToken,
    blobPathname,
    publicUrl,
  })
}
