// POST /api/engagement/refresh — fetch the latest Buffer stats for a single
// published content_item, write a new engagement_snapshots row, return it.
//
// Tier 2a of the exemplar feedback loop: manual, editor-driven refresh that
// surfaces "did this post actually perform" data inside ReviewPost. No cron
// yet — Tier 2b will walk recent posts on a schedule and auto-flip
// performed_well based on workspace-relative thresholds.
//
// Buffer Classic API v1: GET /updates/:id.json returns the update record
// including a `statistics` block (reach, clicks, retweets, favorites, likes,
// mentions, shares, comments — varies by platform). We persist whatever the
// payload contains as a jsonb blob so we don't drop fields when Buffer adds
// new ones.

import { workspaceScope } from '../_lib/workspaceScope.js'
import { getCredential } from '../_lib/getCredential.js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY
const BUFFER_API   = 'https://api.bufferapp.com/1'

async function sb(path, init = {}) {
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

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  let scope
  try {
    scope = await workspaceScope(req)
  } catch (e) {
    return res.status(400).json({ error: e?.message || 'workspace unresolved' })
  }
  const wsId = scope.workspace.id

  const body = (typeof req.body === 'object' && req.body) ? req.body : {}
  const { contentItemId } = body
  if (!contentItemId) return res.status(400).json({ error: 'Missing contentItemId' })

  // Look the item up — must belong to this workspace and have a buffer_update_id.
  const itemRes = await sb(`content_items?id=eq.${contentItemId}&workspace_id=eq.${wsId}&select=id,buffer_update_id,platform,status&limit=1`)
  if (!itemRes.ok) return res.status(500).json({ error: 'db error' })
  const rows = await itemRes.json()
  const item = rows?.[0]
  if (!item) return res.status(404).json({ error: 'content item not found' })
  if (!item.buffer_update_id) {
    return res.status(400).json({ error: 'This content item has no buffer_update_id — engagement is only available for posts published through Buffer.' })
  }

  // Resolve the per-workspace Buffer token.
  const cred = await getCredential(wsId, 'buffer')
  if (!cred?.secret) {
    return res.status(503).json({ error: 'Buffer is not configured for this workspace. Add a Buffer access token in Workspace Settings.' })
  }

  // Fetch the update. Buffer's /updates/:id.json includes `statistics` for
  // sent updates; pending/scheduled updates have an empty stats object.
  let bufferData
  try {
    const r = await fetch(`${BUFFER_API}/updates/${encodeURIComponent(item.buffer_update_id)}.json?access_token=${encodeURIComponent(cred.secret)}`)
    if (!r.ok) {
      const text = await r.text().catch(() => '')
      return res.status(502).json({ error: `Buffer returned ${r.status}`, detail: text.slice(0, 300) })
    }
    bufferData = await r.json()
  } catch (e) {
    return res.status(502).json({ error: 'Buffer fetch failed', detail: e?.message })
  }

  const stats = {
    statistics:    bufferData?.statistics    ?? {},
    status:        bufferData?.status        ?? null,
    sent_at:       bufferData?.sent_at       ?? null,
    service:       bufferData?.service       ?? null,
    service_link:  bufferData?.service_link  ?? null,
  }

  const insertRes = await sb('engagement_snapshots', {
    method: 'POST',
    body: JSON.stringify({
      workspace_id:    wsId,
      content_item_id: contentItemId,
      source:          'buffer',
      stats,
    }),
  })
  if (!insertRes.ok) {
    const text = await insertRes.text().catch(() => '')
    return res.status(500).json({ error: 'failed to write snapshot', detail: text.slice(0, 300) })
  }
  const inserted = await insertRes.json()
  return res.status(200).json({ snapshot: inserted?.[0] || null })
}
