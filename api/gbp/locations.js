// Returns the list of configured GBP locations for the active workspace.
// Reads from workspace_credentials.config (location_ids[], location_names[],
// account_id) via getCredential('gbp'). Legacy env-var fallback inside
// getCredential keeps per-brand deployments working.

import { getCredential } from '../_lib/getCredential.js'
import { workspaceScope } from '../_lib/workspaceScope.js'

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  const scope = await workspaceScope(req)
  const cred = await getCredential(scope?.workspace?.id, 'gbp')
  const ids = Array.isArray(cred?.config?.location_ids) ? cred.config.location_ids : []
  const names = Array.isArray(cred?.config?.location_names) ? cred.config.location_names : []

  if (!ids.length) {
    return res.status(503).json({ error: 'GBP not configured for this workspace. Add GBP credentials in Workspace Settings → Publishing credentials.' })
  }

  const locations = ids.map((id, i) => ({
    id,
    name: names[i] || id, // fall back to raw ID if no friendly name provided
  }))

  return res.status(200).json({ locations, accountId: cred?.config?.account_id || '' })
}
