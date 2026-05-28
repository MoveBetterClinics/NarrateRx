import { withSentry } from '../_lib/sentry.js'
export const config = { runtime: 'nodejs' }
// GET /api/engagement/top-performers — returns top 5 content items by
// engagement across both Buffer and GA4 sources.
//
// Queries engagement_snapshots (workspace-scoped) for the latest snapshot
// per content item, scores each item by source-appropriate signal (reach for
// Buffer, pageviews for GA4), and returns the top 5. This is the unified
// reader for the "What's working" widget in HomeRightRail and the
// topic-suggestion enrichment in /api/topic-suggestions.
//
// Replaces the old buffer_metrics-only fetchTopPerformers approach which was
// invisible to website-published content with GA4 data.

import { workspaceContext } from '../_lib/workspaceContext.js'
import { requireRole } from '../_lib/auth.js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY
const LIMIT = 5

function sb(path) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: {
      apikey:        SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
    },
  })
}

// Score a snapshot by its source. Returns { score, reach, pageviews, engagement }.
function scoreSnapshot(snap) {
  if (snap.source === 'ga4') {
    const pageviews = snap.stats?.pageviews ?? 0
    return { score: pageviews, pageviews, reach: 0, engagement: 0 }
  }
  // Buffer (and any future social source)
  const stats = snap.stats?.statistics ?? {}
  const likes = stats.likes ?? stats.favorites ?? 0
  const reach  = stats.reach ?? 0
  const engagement = likes + (stats.comments ?? 0) + (stats.shares ?? 0)
  return { score: reach, reach, pageviews: 0, engagement }
}

export default withSentry(async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  const ws = await workspaceContext(req)
  if (!ws) return res.status(400).json({ error: 'Workspace not resolved' })

  const auth = await requireRole(req, null, { orgId: ws.clerk_org_id })
  if (!auth.ok) {
    const status = auth.reason === 'no-token' ? 401 : 403
    return res.status(status).json({ error: auth.reason })
  }

  // Fetch the 150 most-recent snapshots for this workspace. We over-fetch so
  // we can dedupe to latest-per-item in JS and still have enough coverage to
  // surface 5 performers even in active workspaces.
  const r = await sb(
    `engagement_snapshots?workspace_id=eq.${encodeURIComponent(ws.id)}` +
    `&order=fetched_at.desc&limit=150` +
    `&select=content_item_id,source,stats,fetched_at,content_items(id,topic,platform,status,resolved_url)`,
  )
  if (!r.ok) return res.status(500).json({ error: 'Database error' })
  const rows = await r.json().catch(() => [])

  // Dedupe to latest snapshot per content_item (rows are already ordered desc).
  // Filter out items that are no longer published (content_items join returns
  // null when the FK row is deleted; status check catches soft-unpublished).
  const seen = new Set()
  const candidates = []
  for (const row of rows) {
    if (seen.has(row.content_item_id)) continue
    seen.add(row.content_item_id)
    const ci = row.content_items
    if (!ci || ci.status !== 'published') continue
    const { score, reach, pageviews, engagement } = scoreSnapshot(row)
    if (score <= 0) continue
    candidates.push({
      id:          ci.id,
      topic:       ci.topic || 'Untitled',
      platform:    ci.platform,
      resolved_url: ci.resolved_url ?? null,
      source:      row.source,
      score,
      reach,
      pageviews,
      engagement,
      fetched_at:  row.fetched_at,
    })
  }

  // Sort by score desc, return top N.
  candidates.sort((a, b) => b.score - a.score)
  return res.status(200).json({ performers: candidates.slice(0, LIMIT) })
})
