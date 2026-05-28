// Buffer Analyze endpoint — Node.js runtime.
//
// Fetches post-performance metrics for a published content item from the
// Buffer GraphQL API and caches them on the content_items row so the UI
// doesn't re-fetch on every page load.
//
// Metrics are re-fetched on explicit user request (Refresh button). The
// cached value is returned directly when present and < 30 min old unless
// ?force=true is passed. Buffer stats settle over hours, not seconds, so
// 30-minute cache is plenty fresh.
//
// Handler shape: Node runtime (req, res) — never return new Response() on
// Node; the function will silently hang until the 300s timeout.
export const config = { runtime: 'nodejs' }

import { workspaceContext } from './_lib/workspaceContext.js'
import { requireRole } from './_lib/auth.js'
import { getCredential } from './_lib/getCredential.js'
import { fetchPostStats } from './_lib/bufferPostStats.js'
const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY
const CACHE_TTL_MS = 30 * 60 * 1000 // 30 minutes

function sb(path, init = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
      ...init.headers,
    },
  })
}

// Extract a flat metrics object from the Buffer statistics blob.
// Buffer omits zero-value fields; default missing ones to 0.
// GraphQL returns 'likes'; v1 REST returned 'favorites' — handle both.
function extractMetrics(stats = {}) {
  const likes = stats.likes ?? stats.favorites ?? 0
  return {
    clicks:      stats.clicks      ?? 0,
    reach:       stats.reach       ?? 0,
    impressions: stats.impressions ?? 0,
    favorites:   likes,
    mentions:    stats.mentions    ?? 0,
    shares:      stats.shares      ?? 0,
    comments:    stats.comments    ?? 0,
    engagement:  likes + (stats.comments ?? 0) + (stats.shares ?? 0),
  }
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  const { searchParams } = new URL(req.url, 'http://localhost')
  const contentItemId = searchParams.get('contentItemId')
  const force = searchParams.get('force') === 'true'

  if (!contentItemId) return res.status(400).json({ error: 'Missing contentItemId' })

  const ws = await workspaceContext(req)
  if (!ws) return res.status(400).json({ error: 'Workspace not resolved' })

  const auth = await requireRole(req, null, { orgId: ws.clerk_org_id })
  if (!auth.ok) {
    const status = auth.reason === 'no-token' ? 401 : 403
    return res.status(status).json({ error: auth.reason })
  }

  // Fetch the content item — must belong to this workspace
  const itemRes = await sb(
    `content_items?id=eq.${contentItemId}&workspace_id=eq.${ws.id}&select=id,buffer_update_id,buffer_metrics,buffer_metrics_fetched_at&limit=1`,
  )
  if (!itemRes.ok) return res.status(500).json({ error: 'Database error' })
  const items = await itemRes.json().catch(() => [])
  const item = items[0]
  if (!item) return res.status(404).json({ error: 'Content item not found' })

  if (!item.buffer_update_id) {
    return res.status(200).json({ metrics: null, reason: 'not_published' })
  }

  // Return cached value if fresh enough and not force-refreshing
  if (!force && item.buffer_metrics && item.buffer_metrics_fetched_at) {
    const age = Date.now() - new Date(item.buffer_metrics_fetched_at).getTime()
    if (age < CACHE_TTL_MS) {
      return res.status(200).json({
        metrics: item.buffer_metrics,
        fetchedAt: item.buffer_metrics_fetched_at,
        cached: true,
      })
    }
  }

  // Fetch fresh from Buffer
  const cred = await getCredential(ws.id, 'buffer')
  if (!cred?.secret) {
    // No Buffer credentials — return cached data if present, otherwise null
    if (item.buffer_metrics) {
      return res.status(200).json({
        metrics: item.buffer_metrics,
        fetchedAt: item.buffer_metrics_fetched_at,
        cached: true,
        warning: 'Buffer not configured; returning cached metrics',
      })
    }
    return res.status(200).json({ metrics: null, reason: 'buffer_not_configured' })
  }

  const result = await fetchPostStats(cred.secret, item.buffer_update_id)

  if (!result.ok || !result.post) {
    console.error(`[buffer-analytics] fetchPostStats failed for ${item.buffer_update_id}`)
    if (item.buffer_metrics) {
      return res.status(200).json({
        metrics: item.buffer_metrics,
        fetchedAt: item.buffer_metrics_fetched_at,
        cached: true,
        warning: 'Buffer API error; returning cached metrics',
      })
    }
    return res.status(502).json({ error: 'Failed to fetch metrics from Buffer' })
  }

  const metrics = extractMetrics(result.post.statistics || {})
  const fetchedAt = new Date().toISOString()

  // Cache the result on the content item row (fire-and-forget — don't block response)
  sb(`content_items?id=eq.${contentItemId}&workspace_id=eq.${ws.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ buffer_metrics: metrics, buffer_metrics_fetched_at: fetchedAt }),
  }).catch((e) => console.error('[buffer-analytics] cache write failed:', e?.message))

  return res.status(200).json({ metrics, fetchedAt, cached: false })
}
