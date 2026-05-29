import { withSentry } from '../../_lib/sentry.js'
import { requireRole, requireCapability } from '../../_lib/auth.js'
import { CAP_INTEGRATIONS_CONNECT } from '../../_lib/capabilities.js'
import { workspaceContext } from '../../_lib/workspaceContext.js'
import { enforceLimit } from '../../_lib/ratelimit.js'
import {
  accessTokenForWorkspace,
  deleteDriveCredential,
  DriveAuthError,
  revokeToken,
} from '../../_lib/driveAuth.js'

// DELETE /api/integrations/drive/disconnect
//
// Best-effort revoke of the access token at Google's side, then delete the
// workspace_credentials row. Existing imported assets stay in media_assets —
// only the connection is removed. A new import requires reconnect.

export const config = { runtime: 'nodejs' }

async function handler(req, res) {
  if (req.method !== 'DELETE' && req.method !== 'POST') {
    return res.status(405).json({ error: 'method-not-allowed' })
  }

  const workspace = await workspaceContext(req)
  if (!workspace) return res.status(404).json({ error: 'no-workspace-context' })

  const auth = await requireRole(req, ['admin'], { orgId: workspace.clerk_org_id })
  if (!auth.ok) {
    return res.status(auth.reason === 'forbidden' ? 403 : 401).json({ error: auth.reason })
  }

  // Phase 4 PR 3: capability gate.
  const capAuth = await requireCapability(req, workspace, [CAP_INTEGRATIONS_CONNECT])
  if (!capAuth.ok) {
    return res.status(403).json({ error: capAuth.reason, missing: capAuth.missing })
  }

  if (!(await enforceLimit(req, res, 'generic'))) return

  // Try to grab a fresh access token so we can revoke at Google. Revoking the
  // access token also invalidates its parent refresh token. We swallow errors
  // here — even if revoke fails, the local credential row gets deleted below
  // so the workspace stops appearing as connected.
  try {
    const accessToken = await accessTokenForWorkspace(workspace.id)
    await revokeToken(accessToken)
  } catch (e) {
    if (!(e instanceof DriveAuthError)) {
      console.warn('[drive/disconnect] revoke skipped:', e?.message)
    }
  }

  try {
    await deleteDriveCredential(workspace.id)
  } catch (e) {
    console.error('[drive/disconnect] delete failed:', e?.message)
    return res.status(500).json({ error: 'delete-failed' })
  }

  return res.status(200).json({ ok: true })
}

export default withSentry(handler)
