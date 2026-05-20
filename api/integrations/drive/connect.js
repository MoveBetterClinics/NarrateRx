import { withSentry } from '../../_lib/sentry.js'
import { requireRole } from '../../_lib/auth.js'
import { workspaceContext } from '../../_lib/workspaceContext.js'
import { enforceLimit } from '../../_lib/ratelimit.js'
import { buildAuthorizationUrl, driveRedirectUri, signOAuthState } from '../../_lib/driveAuth.js'

// POST /api/integrations/drive/connect
//
// Admin clicks "Connect Google Drive" in Settings → Integrations. This endpoint
// builds the Google OAuth consent URL and returns it to the browser, which
// window.location's to it. The state token round-trips through Google so the
// callback (which runs on apex, with no workspace host) knows which workspace
// the consent belongs to.
//
// Why no auto-redirect: the browser fetches this via apiFetch (which sets the
// Bearer token + credentials: 'include'). A 302 from a fetch() doesn't trigger
// a top-level navigation, and the browser can't follow the Google flow inside
// an XHR. So the handler returns { url } and the client does the redirect.

export const config = { runtime: 'nodejs' }

async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'method-not-allowed' })
  }

  const workspace = await workspaceContext(req)
  if (!workspace) return res.status(404).json({ error: 'no-workspace-context' })

  const auth = await requireRole(req, ['admin'], { orgId: workspace.clerk_org_id })
  if (!auth.ok) {
    return res.status(auth.reason === 'forbidden' ? 403 : 401).json({ error: auth.reason })
  }

  if (!(await enforceLimit(req, res, 'generic'))) return

  if (!process.env.GOOGLE_DRIVE_CLIENT_ID || !process.env.GOOGLE_DRIVE_CLIENT_SECRET) {
    return res.status(503).json({ error: 'drive-not-configured', message: 'Google Drive OAuth credentials are not set up on this deployment.' })
  }

  let state
  try {
    state = signOAuthState({
      workspaceId: workspace.id,
      slug: workspace.slug,
      userId: auth.userId,
    })
  } catch (e) {
    console.error('[drive/connect] state sign failed:', e?.message)
    return res.status(500).json({ error: 'state-sign-failed' })
  }

  const url = buildAuthorizationUrl({
    redirectUri: driveRedirectUri(),
    state,
  })

  return res.status(200).json({ url })
}

export default withSentry(handler)
