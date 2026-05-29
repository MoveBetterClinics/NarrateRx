// GET /api/editorial/coverage
//
// Phase 3 PR 6: Capture Coverage Dashboard data.
//
// Two parallel rollups for the Slate's Coverage tab:
//
//   1. Per-clinician capture activity — total assets, assets in last 14 days,
//      last capture timestamp. Drives "Who needs to capture more?"
//
//   2. Per-topic package coverage — for each workspace.topic_suggestions entry,
//      counts how many story_packages have been generated on that topic.
//      Drives "Which topics still need source material?"
//
// All queries are workspace-scoped + filter archived_at IS NULL. Read-only.
//
// Response 200:
//   {
//     clinicians: [{ id, name, asset_count, asset_count_14d, last_capture_at, winner_count }],
//     topics:     [{ topic, priority, package_count, winner_count }],
//   }
//
// V5 (engagement loop): `winner_count` is the number of published content_items
// flagged `performed_well` (the audience responded) attributed to that topic /
// clinician. The flag is set by a human "winner" toggle in the story-detail view
// and, when GA4/Buffer metrics flow, auto-set by the refresh-engagement cron.
// Surfacing it here lets the story director double down on what's working.

export const config = { runtime: 'nodejs' }

import { requireRole } from '../_lib/auth.js'
import { ALL_KNOWN_ROLES } from '../_lib/roles.js'
import { workspaceContext } from '../_lib/workspaceContext.js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY

function sb(path, init = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      ...init.headers,
    },
  })
}

const FOURTEEN_DAYS_MS = 14 * 24 * 60 * 60 * 1000

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'method_not_allowed' })
  }

  const ws = await workspaceContext(req)
  if (!ws) return res.status(404).json({ error: 'no_workspace' })
  if (!ws.video_pipeline_enabled) {
    return res.status(403).json({ error: 'feature_disabled' })
  }

  const auth = await requireRole(req, ALL_KNOWN_ROLES, { orgId: ws.clerk_org_id })
  if (!auth.ok) {
    return res.status(auth.reason === 'forbidden' ? 403 : 401).json({ error: auth.reason })
  }

  const since14d = new Date(Date.now() - FOURTEEN_DAYS_MS).toISOString()

  // --- Pull clinicians + their assets in one fetch each (small workspaces) ---
  // 1. Workspace clinicians
  const cliniciansRes = await sb(`clinicians?workspace_id=eq.${ws.id}&select=id,name&order=name.asc`)
  if (!cliniciansRes.ok) return res.status(500).json({ error: 'db_error_clinicians' })
  const clinicians = await cliniciansRes.json()

  // 2. Non-archived assets in workspace (id, clinician_id, captured_at, created_at)
  // We aggregate client-side rather than PostgREST group-by because the result
  // set is bounded (typically <2000 rows even for active workspaces).
  const assetsRes = await sb(
    `media_assets?workspace_id=eq.${ws.id}&archived_at=is.null&select=id,clinician_id,captured_at,created_at`
  )
  if (!assetsRes.ok) return res.status(500).json({ error: 'db_error_assets' })
  const assets = await assetsRes.json()

  // 3. Story packages (non-skipped) for topic coverage rollup
  const packagesRes = await sb(
    `story_packages?workspace_id=eq.${ws.id}&status=in.(complete,approved)&select=id,topic`
  )
  if (!packagesRes.ok) return res.status(500).json({ error: 'db_error_packages' })
  const packages = await packagesRes.json()

  // 4. Published winners (performed_well) for the engagement loop. Non-fatal:
  //    if this read fails we still return coverage with zero winners rather
  //    than 500 the whole dashboard.
  const winnersRes = await sb(
    `content_items?workspace_id=eq.${ws.id}&status=eq.published&performed_well=eq.true&archived_at=is.null&select=topic,clinician_id`
  )
  const winners = winnersRes.ok ? await winnersRes.json() : []

  // --- Per-clinician rollup ---
  const byClinician = new Map()
  for (const c of clinicians) byClinician.set(c.id, { id: c.id, name: c.name, asset_count: 0, asset_count_14d: 0, last_capture_at: null, winner_count: 0 })

  for (const w of winners) {
    if (!w.clinician_id) continue
    const bucket = byClinician.get(w.clinician_id)
    if (bucket) bucket.winner_count++
  }

  for (const a of assets) {
    if (!a.clinician_id) continue
    const bucket = byClinician.get(a.clinician_id)
    if (!bucket) continue  // asset orphaned to a deleted clinician
    bucket.asset_count++
    const when = a.captured_at || a.created_at
    if (when && when >= since14d) bucket.asset_count_14d++
    if (when && (!bucket.last_capture_at || when > bucket.last_capture_at)) {
      bucket.last_capture_at = when
    }
  }

  // --- Per-topic rollup ---
  const topicSuggestions = Array.isArray(ws.topic_suggestions) ? ws.topic_suggestions : []
  const topicCounts = new Map()
  for (const p of packages) {
    const t = (p.topic || '').trim().toLowerCase()
    if (!t) continue
    topicCounts.set(t, (topicCounts.get(t) || 0) + 1)
  }

  // Winners bucketed by raw topic string (same keying as topicCounts).
  const winnerCounts = new Map()
  for (const w of winners) {
    const t = (w.topic || '').trim().toLowerCase()
    if (!t) continue
    winnerCounts.set(t, (winnerCounts.get(t) || 0) + 1)
  }

  // Attribute a count map to a suggestion via exact title + keyword match.
  const attribute = (countMap, baseKey, keywords) => {
    let count = countMap.get(baseKey) || 0
    if (keywords.length) {
      for (const [key, n] of countMap) {
        if (key === baseKey) continue   // already counted
        if (keywords.some((k) => key.includes(k))) count += n
      }
    }
    return count
  }

  // Resolve coverage by topic-title match + keyword match against package topics.
  const topics = topicSuggestions.map((s) => {
    const baseKey = String(s.topic || '').toLowerCase()
    const keywords = Array.isArray(s.keywords) ? s.keywords.map((k) => String(k).toLowerCase()) : []
    return {
      topic:         s.topic,
      priority:      s.priority || 'medium',
      package_count: attribute(topicCounts, baseKey, keywords),
      winner_count:  attribute(winnerCounts, baseKey, keywords),
    }
  })

  return res.status(200).json({
    clinicians: Array.from(byClinician.values()).sort((a, b) => b.asset_count - a.asset_count),
    topics:     topics.sort((a, b) => {
      // Gaps first (package_count=0), then by priority desc, then by name
      if ((a.package_count === 0) !== (b.package_count === 0)) {
        return a.package_count === 0 ? -1 : 1
      }
      const rank = { high: 3, medium: 2, low: 1 }
      const diff = (rank[b.priority] || 0) - (rank[a.priority] || 0)
      if (diff !== 0) return diff
      return (a.topic || '').localeCompare(b.topic || '')
    }),
    asOf: new Date().toISOString(),
  })
}
