// POST /api/media/multipart/abort
//
// Best-effort cleanup for a multipart upload the user gave up on. @vercel/blob
// 2.3.x doesn't export an abortMultipartUpload SDK method — abandoned uploads
// expire server-side after Vercel's internal TTL. This handler stays so the
// client can call it on Cancel/dismiss for forward compatibility (Vercel may
// expose the abort method in a future minor; when it does, plug it in here
// without changing the client).
//
// Body: { uploadId, key, pathname }
// Auth: same Clerk + workspace gate as create/complete so the endpoint isn't
// a wide-open URL even though it's currently a no-op.

import { withSentry } from '../../_lib/sentry.js'
import { requireRole } from '../../_lib/auth.js'
import { ALL_KNOWN_ROLES } from '../../_lib/roles.js'
import { workspaceScope } from '../../_lib/workspaceScope.js'
import { enforceLimit } from '../../_lib/ratelimit.js'

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

  const { uploadId, key, pathname } = req.body || {}
  if (!uploadId || !key || !pathname) {
    return res.status(400).json({ error: 'uploadId, key, pathname required' })
  }

  // No-op for now (see file header). Acknowledge so the client can clear its
  // IndexedDB record without retrying forever.
  return res.status(200).json({ ok: true, aborted: false, reason: 'sdk-no-op' })
}

export default withSentry(handler)
