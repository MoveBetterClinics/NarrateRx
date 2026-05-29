import { withSentry } from '../_lib/sentry.js'
import { extractPackageShortId } from '../_lib/utm.js'
export const config = { runtime: 'nodejs' }
// Tier 2b — daily engagement refresh + auto-flag.
//
// Vercel cron hits this once a day (vercel.json). For every active workspace
// that has a Buffer credential, walk recent published content_items, refresh
// their Buffer stats into engagement_snapshots, then flip performed_well=true
// on items that beat a workspace+platform-relative threshold. The manual
// thumbs-up still works alongside this — we never *unset* performed_well, so
// editors stay in control of the long-tail exemplar pool.
//
// Heuristic (kept deliberately simple — revisit after we have signal):
//   score(item)  = sum of numeric values in stats.statistics
//   threshold    = 2× median(score across same workspace+platform pool)
//   sample gate  = pool must have ≥ MIN_SAMPLES same-platform items
//
// Median over mean: a single viral post would otherwise drag mean up and
// hide the next round of strong-but-not-viral posts from auto-flagging.
//
// Auth: Bearer CRON_SECRET (same pattern as backup-db).

import { decryptSecret } from '../_lib/credentialCrypto.js'
import { fetchGA4Metrics, urlToPagePath } from '../_lib/ga4.js'
import { fetchPostStats } from '../_lib/bufferPostStats.js'

const SUPABASE_URL  = process.env.SUPABASE_URL
const SUPABASE_KEY  = process.env.SUPABASE_SERVICE_KEY
const MIN_SAMPLES   = 5
const SCORE_MULT    = 2
const SCAN_WINDOW_D = 60     // only consider posts published in the last N days
const SNAPSHOT_MAX_AGE_H = 24 // skip refetch if we have a snapshot newer than this
// GA4 minimum traffic gate (Tier 3): a low-traffic clinic blog where the
// median post gets 3 pageviews shouldn't auto-flag a "winner" at 6 views —
// that's noise, not signal. Require at least this many pageviews before a
// row is even eligible to be flagged. Independent of the median heuristic;
// flagging still requires score > 2× median ON TOP of clearing this bar.
const GA4_MIN_PAGEVIEWS = 50

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

function scoreOf(stats) {
  const s = stats?.statistics
  if (!s || typeof s !== 'object') return 0
  return Object.values(s).reduce((sum, v) => sum + (typeof v === 'number' ? v : 0), 0)
}

function median(nums) {
  const sorted = [...nums].sort((a, b) => a - b)
  const n = sorted.length
  if (!n) return 0
  return n % 2 === 1 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2
}

async function getCredSecret(workspaceId, service) {
  const url = `${SUPABASE_URL}/rest/v1/workspace_credentials?workspace_id=eq.${workspaceId}&service=eq.${service}&status=eq.active&select=secret_ciphertext&limit=1`
  const r = await fetch(url, { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } })
  if (!r.ok) return null
  const rows = await r.json().catch(() => null)
  const ct = rows?.[0]?.secret_ciphertext
  if (!ct) return null
  try { return decryptSecret(ct) } catch { return null }
}

async function getBufferToken(workspaceId) {
  // Inline cred read (the getCredential helper is fine, but this cron is
  // service-side and skipping the helper avoids any future ambient-env
  // fallback that would mask a missing per-workspace token).
  const url = `${SUPABASE_URL}/rest/v1/workspace_credentials?workspace_id=eq.${workspaceId}&service=eq.buffer&status=eq.active&select=secret_ciphertext&limit=1`
  const r = await fetch(url, { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } })
  if (!r.ok) return null
  const rows = await r.json().catch(() => null)
  const ct = rows?.[0]?.secret_ciphertext
  if (!ct) return null
  try { return decryptSecret(ct) } catch { return null }
}

async function fetchBufferStats(token, updateId, platform) {
  const result = await fetchPostStats(token, updateId)
  if (!result.ok || !result.post) return null
  const p = result.post
  return {
    statistics:   p.statistics ?? {},
    status:       p.status     ?? null,
    sent_at:      p.sentAt     ?? null,
    service:      platform     ?? null,
    service_link: null,
  }
}

async function processWorkspace(ws, summary) {
  const token = await getBufferToken(ws.id)
  if (!token) {
    summary.workspaces.push({ id: ws.id, slug: ws.slug, skipped: 'no-buffer-token' })
    return
  }

  // Pull recent published items with a buffer_update_id.
  const sinceIso = new Date(Date.now() - SCAN_WINDOW_D * 24 * 60 * 60 * 1000).toISOString()
  const itemsRes = await sb(
    `content_items?workspace_id=eq.${ws.id}` +
    `&status=eq.published` +
    `&buffer_update_id=not.is.null` +
    `&published_at=gte.${encodeURIComponent(sinceIso)}` +
    `&select=id,platform,buffer_update_id,performed_well,published_at`
  )
  if (!itemsRes.ok) {
    summary.workspaces.push({ id: ws.id, slug: ws.slug, error: `items fetch ${itemsRes.status}` })
    return
  }
  const items = await itemsRes.json()
  if (!Array.isArray(items) || items.length === 0) {
    summary.workspaces.push({ id: ws.id, slug: ws.slug, items: 0 })
    return
  }

  // Refresh snapshots where we don't already have a fresh one.
  const freshCutoff = new Date(Date.now() - SNAPSHOT_MAX_AGE_H * 60 * 60 * 1000).toISOString()
  let refreshed = 0
  for (const item of items) {
    const latestRes = await sb(
      `engagement_snapshots?content_item_id=eq.${item.id}&workspace_id=eq.${ws.id}&order=fetched_at.desc&limit=1&select=fetched_at,stats`
    )
    const latestRows = latestRes.ok ? await latestRes.json().catch(() => []) : []
    const latest = latestRows?.[0]
    if (latest && latest.fetched_at > freshCutoff) {
      item._stats = latest.stats
      continue
    }
    const stats = await fetchBufferStats(token, item.buffer_update_id, item.platform)
    if (!stats) continue
    const ins = await sb('engagement_snapshots', {
      method: 'POST',
      body: JSON.stringify({
        workspace_id:    ws.id,
        content_item_id: item.id,
        source:          'buffer',
        stats,
      }),
    })
    if (ins.ok) {
      refreshed++
      item._stats = stats
    }
  }

  // Group by platform; auto-flag items above the workspace+platform median.
  const byPlatform = {}
  for (const item of items) {
    if (!item._stats) continue
    if (!byPlatform[item.platform]) byPlatform[item.platform] = []
    byPlatform[item.platform].push(item)
  }

  const flagged = []
  for (const [platform, pool] of Object.entries(byPlatform)) {
    if (pool.length < MIN_SAMPLES) continue
    const scores = pool.map(i => scoreOf(i._stats))
    const med = median(scores)
    if (med <= 0) continue
    const bar = med * SCORE_MULT
    for (let i = 0; i < pool.length; i++) {
      const item = pool[i]
      const score = scores[i]
      if (item.performed_well) continue
      if (score <= bar) continue
      const r = await sb(`content_items?id=eq.${item.id}&workspace_id=eq.${ws.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ performed_well: true }),
      })
      if (r.ok) flagged.push({ id: item.id, platform, score, median: med })
    }
  }

  summary.workspaces.push({
    id: ws.id,
    slug: ws.slug,
    source: 'buffer',
    items: items.length,
    refreshed,
    flagged: flagged.length,
    flagged_detail: flagged,
  })
}

// GA4 walker — same shape as processWorkspace (Buffer), different source.
//
// Why a parallel function rather than generalising: Buffer scoring sums
// arbitrary numeric fields in `statistics`; GA4 scoring uses pageviews as
// the single signal (engaged_sessions and engagement_time go into the
// snapshot for later analysis but don't drive the auto-flag — pageviews
// is the signal that matters most for blog content and is the easiest to
// read across workspaces of different sizes). Forcing both into a generic
// scorer would obscure that distinction. Two clean walkers, one shared
// median + flag pattern.
async function processWorkspaceGA4(ws, summary) {
  if (!ws.ga4_property_id) {
    summary.workspaces.push({ id: ws.id, slug: ws.slug, source: 'ga4', skipped: 'no-ga4-property-id' })
    return
  }
  const serviceAccountJson = await getCredSecret(ws.id, 'ga4')
  if (!serviceAccountJson) {
    summary.workspaces.push({ id: ws.id, slug: ws.slug, source: 'ga4', skipped: 'no-ga4-credential' })
    return
  }

  // Pull recent published items that have a resolved_url (set by the
  // website-publish path; legacy rows without one are invisible to GA4
  // until they're republished or backfilled).
  const sinceIso = new Date(Date.now() - SCAN_WINDOW_D * 24 * 60 * 60 * 1000).toISOString()
  const itemsRes = await sb(
    `content_items?workspace_id=eq.${ws.id}` +
    `&status=eq.published` +
    `&resolved_url=not.is.null` +
    `&published_at=gte.${encodeURIComponent(sinceIso)}` +
    `&select=id,platform,resolved_url,performed_well,published_at`
  )
  if (!itemsRes.ok) {
    summary.workspaces.push({ id: ws.id, slug: ws.slug, source: 'ga4', error: `items fetch ${itemsRes.status}` })
    return
  }
  const items = await itemsRes.json()
  if (!Array.isArray(items) || items.length === 0) {
    summary.workspaces.push({ id: ws.id, slug: ws.slug, source: 'ga4', items: 0 })
    return
  }

  // Map URL → pagePath for GA4, and back so we can join the report rows
  // back to content_item ids. Multiple items at the same path is unlikely
  // (slugs collide in the publish layer) but handled by indexing as an
  // array.
  const pathToItems = new Map()
  for (const item of items) {
    const path = urlToPagePath(item.resolved_url)
    if (!path) continue
    item._pagePath = path
    if (!pathToItems.has(path)) pathToItems.set(path, [])
    pathToItems.get(path).push(item)
  }
  const pagePaths = [...pathToItems.keys()]
  if (pagePaths.length === 0) {
    summary.workspaces.push({ id: ws.id, slug: ws.slug, source: 'ga4', items: items.length, skipped: 'no-resolvable-paths' })
    return
  }

  let metricsByPath
  try {
    metricsByPath = await fetchGA4Metrics({
      serviceAccountJson,
      propertyId: ws.ga4_property_id,
      pagePaths,
    })
  } catch (e) {
    summary.workspaces.push({ id: ws.id, slug: ws.slug, source: 'ga4', error: e?.message || 'ga4 fetch failed' })
    return
  }

  // Decide which items need a fresh snapshot written. Reuse the same
  // 24h freshness gate as Buffer to avoid re-writing the same numbers
  // every cron tick, but always pull the latest GA4 numbers if we did
  // make the API call (already paid the cost).
  const freshCutoff = new Date(Date.now() - SNAPSHOT_MAX_AGE_H * 60 * 60 * 1000).toISOString()
  let refreshed = 0
  for (const item of items) {
    if (!item._pagePath) continue
    const stats = metricsByPath[item._pagePath]
    if (!stats) continue // GA4 has nothing for this path yet
    item._stats = stats

    const latestRes = await sb(
      `engagement_snapshots?content_item_id=eq.${item.id}&source=eq.ga4&order=fetched_at.desc&limit=1&select=fetched_at`
    )
    const latest = latestRes.ok ? (await latestRes.json().catch(() => []))?.[0] : null
    if (latest && latest.fetched_at > freshCutoff) continue

    // Enrich stats with package attribution extracted from UTM params on the
    // resolved_url. utm_content=pkg_<short_id> is set by the auto-publish
    // path at publish time; manual publishes without packageId carry no UTM.
    const pkgShortId = extractPackageShortId(item.resolved_url)
    const enrichedStats = pkgShortId ? { ...stats, pkg_short_id: pkgShortId } : stats

    const ins = await sb('engagement_snapshots', {
      method: 'POST',
      body: JSON.stringify({
        workspace_id:    ws.id,
        content_item_id: item.id,
        source:          'ga4',
        stats:           enrichedStats,
      }),
    })
    if (ins.ok) refreshed++
  }

  // Auto-flag against a workspace+platform pool (same MIN_SAMPLES /
  // SCORE_MULT heuristic as Buffer, scored on pageviews only). All website
  // publishes today land on platform='blog', but keying by platform here
  // keeps the heuristic future-proof for other URL-bearing platforms.
  const byPlatform = {}
  for (const item of items) {
    if (!item._stats) continue
    if (!byPlatform[item.platform]) byPlatform[item.platform] = []
    byPlatform[item.platform].push(item)
  }

  const flagged = []
  for (const [platform, pool] of Object.entries(byPlatform)) {
    if (pool.length < MIN_SAMPLES) continue
    const scores = pool.map((i) => i._stats.pageviews || 0)
    const med = median(scores)
    if (med <= 0) continue
    const bar = med * SCORE_MULT
    for (let i = 0; i < pool.length; i++) {
      const item = pool[i]
      const score = scores[i]
      if (item.performed_well) continue
      if (score < GA4_MIN_PAGEVIEWS) continue // absolute traffic floor
      if (score <= bar) continue
      const r = await sb(`content_items?id=eq.${item.id}&workspace_id=eq.${ws.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ performed_well: true }),
      })
      if (r.ok) flagged.push({ id: item.id, platform, pageviews: score, median: med })
    }
  }

  summary.workspaces.push({
    id: ws.id,
    slug: ws.slug,
    source: 'ga4',
    items: items.length,
    refreshed,
    flagged: flagged.length,
    flagged_detail: flagged,
  })
}

async function handler(req, res) {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) return res.status(503).json({ error: 'CRON_SECRET not configured' })
  const auth = req.headers?.authorization || req.headers?.Authorization
  if (auth !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return res.status(503).json({ error: 'Supabase env not configured' })
  }

  // Enumerate active workspaces.
  const wsRes = await fetch(
    `${SUPABASE_URL}/rest/v1/workspaces?status=eq.active&select=id,slug,ga4_property_id`,
    { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
  )
  if (!wsRes.ok) return res.status(500).json({ error: 'workspace fetch failed' })
  const workspaces = await wsRes.json()

  const summary = { startedAt: new Date().toISOString(), workspaces: [] }
  for (const ws of workspaces) {
    try {
      await processWorkspace(ws, summary)
    } catch (e) {
      summary.workspaces.push({ id: ws.id, slug: ws.slug, source: 'buffer', error: e?.message || 'unknown' })
    }
    try {
      await processWorkspaceGA4(ws, summary)
    } catch (e) {
      summary.workspaces.push({ id: ws.id, slug: ws.slug, source: 'ga4', error: e?.message || 'unknown' })
    }
  }
  summary.finishedAt = new Date().toISOString()

  return res.status(200).json(summary)
}

export default withSentry(handler)
