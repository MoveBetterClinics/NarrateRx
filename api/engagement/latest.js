// GET /api/engagement/latest?contentItemId=… — return the most recent
// engagement_snapshots row for a content item (workspace-scoped). Used by
// ReviewPost to render the engagement panel without forcing a re-fetch
// against Buffer on every page load. Tier 2a.

import { workspaceScope } from '../_lib/workspaceScope.js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  let scope
  try {
    scope = await workspaceScope(req)
  } catch (e) {
    return res.status(400).json({ error: e?.message || 'workspace unresolved' })
  }
  const wsId = scope.workspace.id

  const contentItemId = (req.query?.contentItemId) || new URL(req.url, 'http://x').searchParams.get('contentItemId')
  if (!contentItemId) return res.status(400).json({ error: 'Missing contentItemId' })

  const url = `${SUPABASE_URL}/rest/v1/engagement_snapshots?content_item_id=eq.${contentItemId}&workspace_id=eq.${wsId}&order=fetched_at.desc&limit=1&select=id,source,stats,fetched_at`
  const r = await fetch(url, { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } })
  if (!r.ok) return res.status(500).json({ error: 'db error' })
  const rows = await r.json().catch(() => [])
  return res.status(200).json({ snapshot: rows?.[0] || null })
}
