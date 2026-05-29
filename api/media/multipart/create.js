// POST /api/media/multipart/create
//
// Initiates a resumable multipart upload. Server-side:
//   1. Validates Clerk auth + workspace scope (same gate as /api/media/upload).
//   2. Computes the canonical pathname for the new asset.
//   3. Calls @vercel/blob#createMultipartUpload to reserve a multipart upload
//      slot on Vercel Blob. Returns { key, uploadId }.
//   4. Mints a long-lived client token (validUntil = now + 24h) so the browser
//      can run uploadPart / completeMultipartUpload directly against Blob
//      storage from @vercel/blob/client. Part bytes never proxy through this
//      function — the function only signs the handshake.
//   5. Bakes scope + meta into a server-issued tokenPayload that the client
//      echoes back to /complete. Same shape as the single-shot upload's
//      tokenPayload so recordUploadedAsset.js can consume both.
//
// Response:
//   { uploadId, key, pathname, contentType, clientToken, tokenPayloadServer }
//   - clientToken is the value the browser passes as `token` to uploadPart.
//   - tokenPayloadServer is an opaque JSON string the browser must POST back
//     to /complete unchanged. Carries the scope binding so the completion
//     handler can verify the asset belongs to the calling workspace.

import { withSentry } from '../../_lib/sentry.js'
import { createMultipartUpload } from '@vercel/blob'
import { generateClientTokenFromReadWriteToken } from '@vercel/blob/client'
import { requireRole } from '../../_lib/auth.js'
import { ALL_KNOWN_ROLES } from '../../_lib/roles.js'
import { workspaceScope } from '../../_lib/workspaceScope.js'
import { enforceLimit } from '../../_lib/ratelimit.js'

export const config = { runtime: 'nodejs' }

const ALLOWED_MIME = [
  'image/jpeg', 'image/png', 'image/gif', 'image/webp',
  'image/heic', 'image/heif',
  'video/mp4', 'video/quicktime', 'video/webm', 'video/x-m4v',
]

const PURPOSES = new Set(['interview', 'broll', 'photo', 'brand'])

// 24h. Long enough for an interview clip to upload across a sleep cycle but
// short enough that an abandoned/leaked token isn't a perpetual write key.
const TOKEN_TTL_MS = 24 * 60 * 60 * 1000

// 5 GB ceiling — Vercel Blob hard limit. The single-shot handshake uses
// 500 MB because it can't resume; multipart should accept the platform max.
const MAX_BYTES = 5 * 1024 * 1024 * 1024

function safeFilename(name) {
  return (name || 'file').replace(/[^a-z0-9-_]+/gi, '-').toLowerCase()
}

async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const scope = await workspaceScope(req)
  const auth = await requireRole(req, ALL_KNOWN_ROLES, { orgId: scope.workspace.clerk_org_id })
  if (!auth.ok) {
    return res.status(auth.reason === 'forbidden' ? 403 : 401).json({ error: auth.reason })
  }
  if (!(await enforceLimit(req, res, 'media'))) return

  const body = req.body || {}
  const {
    contentType,
    filename,
    fileSize,
    meta = {},
  } = body

  if (!contentType || !ALLOWED_MIME.includes(contentType)) {
    return res.status(400).json({ error: 'Unsupported content type' })
  }
  if (typeof fileSize !== 'number' || fileSize <= 0 || fileSize > MAX_BYTES) {
    return res.status(400).json({ error: 'Invalid file size' })
  }
  if (!filename || typeof filename !== 'string') {
    return res.status(400).json({ error: 'filename required' })
  }

  const ext      = (filename.match(/\.[^.]+$/) || [''])[0]
  const baseName = safeFilename(filename.replace(/\.[^.]+$/, ''))
  const stamp    = new Date().toISOString().replace(/[:.]/g, '-')
  const folder   = meta.parentId ? 'media/edited' : 'media/raw'
  const pathname = `${folder}/${stamp}-${baseName}${ext}`

  let created
  try {
    created = await createMultipartUpload(pathname, {
      access: 'public',
      contentType,
      addRandomSuffix: false,
    })
  } catch (e) {
    return res.status(500).json({ error: `createMultipartUpload failed: ${e.message}` })
  }

  // The opaque tokenPayload baked into the client token — used by the SDK to
  // re-attest the upload on each part call. We also return it as
  // `tokenPayloadServer` so /complete can verify the client didn't substitute
  // a different workspace's scope.
  const validUntil = Date.now() + TOKEN_TTL_MS
  const tokenPayloadServer = JSON.stringify({
    scopeColumn: scope.column,
    scopeId: scope.id,
    filename: filename,
    createdBy: meta.createdBy || null,
    patientPseudonym: meta.patientPseudonym || null,
    condition: meta.condition || null,
    capturedAt: meta.capturedAt || null,
    notes: meta.notes || null,
    assetPurpose: PURPOSES.has(meta.assetPurpose) ? meta.assetPurpose : null,
    speakerRole: meta.speakerRole || null,
    parentId: meta.parentId || null,
    contentPieceId: meta.contentPieceId || null,
    collectionId: typeof meta.collectionId === 'string' && meta.collectionId ? meta.collectionId : null,
    staffId: typeof meta.staffId === 'string' && meta.staffId ? meta.staffId : null,
  })

  let clientToken
  try {
    clientToken = await generateClientTokenFromReadWriteToken({
      pathname,
      onUploadCompleted: undefined,
      allowedContentTypes: [contentType],
      maximumSizeInBytes: fileSize,
      validUntil,
      addRandomSuffix: false,
      tokenPayload: tokenPayloadServer,
    })
  } catch (e) {
    return res.status(500).json({ error: `client token mint failed: ${e.message}` })
  }

  return res.status(200).json({
    uploadId: created.uploadId,
    key: created.key,
    pathname,
    contentType,
    clientToken,
    tokenExpiresAt: validUntil,
    tokenPayloadServer,
  })
}

export default withSentry(handler)
