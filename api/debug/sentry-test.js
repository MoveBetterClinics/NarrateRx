import { withSentry } from '../_lib/sentry.js'
import { requireRole } from '../_lib/auth.js'
import { workspaceContext } from '../_lib/workspaceContext.js'

// Throws a synthetic error so we can verify the Sentry pipeline end-to-end:
// init → wrapper catch → scope tags → flush → Sentry inbox.
//
// Admin-gated and only enabled when SENTRY_DEBUG_ENABLED=1 (kept off by
// default so prod doesn't expose an obvious 500 generator).

async function handler(req, res) {
  if (process.env.SENTRY_DEBUG_ENABLED !== '1') {
    return res.status(404).json({ error: 'not-found' })
  }
  await workspaceContext(req)
  const auth = await requireRole(req, ['admin'])
  if (!auth.ok) {
    const status = auth.reason === 'forbidden' ? 403 : 401
    return res.status(status).json({ error: auth.reason })
  }
  throw new Error('sentry-test: synthetic error from /api/debug/sentry-test')
}

export default withSentry(handler)
