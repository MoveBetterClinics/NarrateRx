import { withSentry } from '../../_lib/sentry.js'
import { requireRole, requireCapability } from '../../_lib/auth.js'
import { CAP_INTEGRATIONS_CONNECT } from '../../_lib/capabilities.js'
import { workspaceContext } from '../../_lib/workspaceContext.js'
import { enforceLimit } from '../../_lib/ratelimit.js'
import { accessTokenForWorkspace, DriveAuthError } from '../../_lib/driveAuth.js'

// GET /api/integrations/drive/test
//
// Verifies the stored refresh token can still fetch a valid access token AND
// that Google still recognizes the consent. Returns the connected account's
// email + storage quota so the Settings card can show "Connected as alice@…".

export const config = { runtime: 'nodejs' }

async function handler(req, res) {
  if (req.method !== 'GET') {
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

  let accessToken
  try {
    accessToken = await accessTokenForWorkspace(workspace.id)
  } catch (e) {
    if (e instanceof DriveAuthError) {
      // 412 Precondition Failed reads cleanly as "you need to connect first /
      // again" without overloading 401 (which the UI treats as session expired).
      return res.status(412).json({ error: e.code, message: e.message })
    }
    console.error('[drive/test] access token failed:', e?.message)
    return res.status(502).json({ error: 'refresh-failed', message: e?.message })
  }

  let about
  try {
    const r = await fetch(
      'https://www.googleapis.com/drive/v3/about?fields=user(emailAddress,displayName,photoLink),storageQuota(limit,usage)',
      { headers: { Authorization: `Bearer ${accessToken}` } },
    )
    if (!r.ok) {
      const text = await r.text().catch(() => '')
      console.error('[drive/test] about failed:', r.status, text)
      return res.status(502).json({ error: 'drive-api-failed', status: r.status })
    }
    about = await r.json()
  } catch (e) {
    console.error('[drive/test] about exception:', e?.message)
    return res.status(502).json({ error: 'drive-api-exception', message: e?.message })
  }

  return res.status(200).json({
    ok: true,
    user: {
      email: about?.user?.emailAddress || null,
      name: about?.user?.displayName || null,
      photo: about?.user?.photoLink || null,
    },
    storage: about?.storageQuota
      ? {
          limit: about.storageQuota.limit ? Number(about.storageQuota.limit) : null,
          usage: about.storageQuota.usage ? Number(about.storageQuota.usage) : null,
        }
      : null,
  })
}

export default withSentry(handler)
