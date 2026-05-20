import { withSentry } from '../../_lib/sentry.js'
import { requireRole } from '../../_lib/auth.js'
import { ALL_KNOWN_ROLES } from '../../_lib/roles.js'
import { workspaceContext } from '../../_lib/workspaceContext.js'
import { enforceLimit } from '../../_lib/ratelimit.js'
import { listDrive } from '../../_lib/driveClient.js'
import { DriveAuthError } from '../../_lib/driveAuth.js'

// GET /api/integrations/drive/list?folder=<id>&q=<query>&pageToken=<token>
//
// Returns { folder, items, nextPageToken }. The picker UI uses this to render
// the browse tree and search results. Open to any role that can upload media
// — Drive browse is read-only and surfaces the workspace's own connected
// account, not other users' Drives, so giving publishers/clinicians access
// matches the upload-to-Library permission model.

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

  const url = new URL(req.url, 'http://localhost')
  const folder = url.searchParams.get('folder') || 'root'
  const query = url.searchParams.get('q') || ''
  const pageToken = url.searchParams.get('pageToken') || ''
  const pageSize = Math.min(Math.max(Number(url.searchParams.get('pageSize') || '100'), 1), 500)

  try {
    const result = await listDrive({
      workspaceId: workspace.id,
      folderId: folder,
      query,
      pageToken,
      pageSize,
    })
    return res.status(200).json(result)
  } catch (e) {
    if (e instanceof DriveAuthError) {
      return res.status(412).json({ error: e.code, message: e.message })
    }
    if (e.status === 401 || e.status === 403) {
      return res.status(412).json({ error: 'reconnect_required', message: 'Google rejected the access token — reconnect Google Drive.' })
    }
    console.error('[drive/list] failed:', e?.message)
    return res.status(502).json({ error: 'drive-api-failed', message: e?.message })
  }
}

export default withSentry(handler)
