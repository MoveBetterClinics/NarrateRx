// POST /api/media/multipart/complete
//
// Finalizes a resumable multipart upload after all parts have been PUT
// directly browser → Vercel Blob. Calls completeMultipartUpload server-side
// so the row insert + AI pipeline runs in the same trust context as the
// single-shot upload (recordUploadedAsset re-fetches the workspace by id
// from the round-tripped tokenPayloadServer; the client never gets to choose
// the workspace).
//
// Body:
//   { uploadId, key, pathname, contentType, parts: [{ partNumber, etag }],
//     tokenPayloadServer }
//
// tokenPayloadServer is the JSON string handed to the browser at /create
// time. We re-verify scope against the caller's workspace so a token from
// workspace A can't be replayed against workspace B even if it leaks.

import { withSentry } from '../../_lib/sentry.js'
import { completeMultipartUpload } from '@vercel/blob'
import { requireRole } from '../../_lib/auth.js'
import { ALL_KNOWN_ROLES } from '../../_lib/roles.js'
import { workspaceScope } from '../../_lib/workspaceScope.js'
import { enforceLimit } from '../../_lib/ratelimit.js'
import { recordUploadedAsset } from '../../_lib/recordUploadedAsset.js'

export const config = { runtime: 'nodejs' }

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

  const { uploadId, key, pathname, contentType, parts, tokenPayloadServer } = req.body || {}

  if (!uploadId || !key || !pathname || !Array.isArray(parts) || parts.length === 0) {
    return res.status(400).json({ error: 'uploadId, key, pathname, parts[] required' })
  }
  if (!tokenPayloadServer || typeof tokenPayloadServer !== 'string') {
    return res.status(400).json({ error: 'tokenPayloadServer required' })
  }

  let parsedPayload
  try {
    parsedPayload = JSON.parse(tokenPayloadServer)
  } catch {
    return res.status(400).json({ error: 'malformed tokenPayloadServer' })
  }

  // Cross-tenant guard: the workspace baked into the create-time token must
  // match the workspace the caller is on now. Without this, a token leaked
  // from workspace A could be replayed by a member of workspace B to insert
  // a media row in A.
  if (parsedPayload.scopeColumn !== scope.column || parsedPayload.scopeId !== scope.id) {
    return res.status(403).json({ error: 'scope mismatch' })
  }

  // Parts must be (partNumber asc, unique). Vercel's complete call expects
  // ordered parts; client orchestrator already builds it that way, but defend
  // against a buggy/forged caller.
  const cleanParts = parts
    .map((p) => ({ partNumber: Number(p.partNumber), etag: String(p.etag || '') }))
    .filter((p) => Number.isInteger(p.partNumber) && p.partNumber >= 1 && p.etag)
    .sort((a, b) => a.partNumber - b.partNumber)
  if (cleanParts.length !== parts.length) {
    return res.status(400).json({ error: 'invalid parts[]' })
  }

  let blob
  try {
    blob = await completeMultipartUpload(pathname, cleanParts, {
      access: 'public',
      contentType: contentType || undefined,
      uploadId,
      key,
    })
  } catch (e) {
    return res.status(500).json({ error: `completeMultipartUpload failed: ${e.message}` })
  }

  const inserted = await recordUploadedAsset({
    blob: {
      url: blob.url,
      pathname: blob.pathname,
      contentType: blob.contentType,
      // completeMultipartUpload does not return size; reconstruct from the
      // assembled total so recordUploadedAsset can stamp size_bytes.
      size: typeof req.body.totalSize === 'number' ? req.body.totalSize : null,
    },
    tokenPayload: parsedPayload,
  })

  return res.status(200).json({
    url: blob.url,
    pathname: blob.pathname,
    contentType: blob.contentType,
    assetId: inserted?.id || null,
  })
}

export default withSentry(handler)
