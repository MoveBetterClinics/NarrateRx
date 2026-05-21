import { withSentry } from '../../_lib/sentry.js'
import { requireRole } from '../../_lib/auth.js'
import { ALL_KNOWN_ROLES } from '../../_lib/roles.js'
import { workspaceContext } from '../../_lib/workspaceContext.js'
import { enforceLimit } from '../../_lib/ratelimit.js'
import { accessTokenForWorkspace, DriveAuthError } from '../../_lib/driveAuth.js'

// GET /api/integrations/drive/picker-token
//
// Issues a short-lived OAuth access token (1h) plus the public Picker
// developer key + GCP project number to the browser. The DriveImportPicker
// passes these into Google Picker's constructor; Picker handles browse +
// search + multi-select inside Google's own UI, then calls our import
// endpoint with the chosen file IDs.
//
// Why server-issued: the access token comes from the workspace's stored
// refresh token (workspace_credentials.service='drive'). The browser never
// sees the refresh token. The access token expires in ~1h, after which the
// browser re-fetches via this endpoint if the user re-opens the picker.
//
// Security: this is an admin-ish capability — anyone who can fetch a Picker
// token can browse the workspace's connected Drive. We open it to any
// authenticated workspace member (same as the importer itself, since the
// connected Drive is shared at the workspace level). The token is read-only
// (drive.file scope) and only sees files the user explicitly picks. Even if
// the token leaked client-side, the worst case is the leaker can see files
// already approved for our app — they can't browse the whole Drive.

export const config = { runtime: 'nodejs' }

async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'method-not-allowed' })
  }

  const workspace = await workspaceContext(req)
  if (!workspace) return res.status(404).json({ error: 'no-workspace-context' })

  const auth = await requireRole(req, ALL_KNOWN_ROLES, { orgId: workspace.clerk_org_id })
  if (!auth.ok) {
    return res.status(auth.reason === 'forbidden' ? 403 : 401).json({ error: auth.reason })
  }

  if (!(await enforceLimit(req, res, 'generic'))) return

  const developerKey = process.env.GOOGLE_DRIVE_API_KEY
  const appId = process.env.GOOGLE_DRIVE_APP_ID
  if (!developerKey || !appId) {
    return res.status(503).json({
      error: 'picker-not-configured',
      message: 'Google Picker isn’t configured on this deployment (missing GOOGLE_DRIVE_API_KEY or GOOGLE_DRIVE_APP_ID).',
    })
  }

  let accessToken
  try {
    accessToken = await accessTokenForWorkspace(workspace.id)
  } catch (e) {
    if (e instanceof DriveAuthError) {
      return res.status(412).json({ error: e.code, message: e.message })
    }
    console.error('[drive/picker-token] failed:', e?.message)
    return res.status(502).json({ error: 'refresh-failed', message: e?.message })
  }

  // Cache-Control: no-store so the access token never lands in a shared cache.
  // Each picker open should round-trip to fetch a fresh token.
  res.setHeader('Cache-Control', 'no-store')
  return res.status(200).json({
    accessToken,
    developerKey,
    appId,
  })
}

export default withSentry(handler)
