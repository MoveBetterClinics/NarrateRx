// GET /api/cron/resume-longform-renders  (Vercel cron, every 5 minutes)
//
// Safety-net for the chunked keep-whole long-form render. The happy path is a
// self-continuing chain: each engine pass POSTs the worker endpoint to continue
// on a fresh instance. If a single continuation is ever dropped (network blip,
// instance recycled before the fetch flushed), the chain stalls and the package
// would sit 'generating' forever. This cron finds chunked jobs with no piece
// activity for a few minutes and re-kicks the worker.
//
// Re-kicking a HEALTHY chain is a cheap no-op: the resumed pass finds the
// in-flight piece still 'rendering' (not yet stale — STALE_RENDERING_MS in the
// engine is longer than this stall threshold), claims nothing, and exits without
// continuing. Only a genuinely stalled chain gets work.
//
// Auth: Bearer CRON_SECRET (same as the other cron handlers).

export const config = { runtime: 'nodejs' }

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY

// No piece updated in this long ⇒ the chain is presumed stalled. Must exceed a
// normal single-piece render time so a healthy chain is never flagged.
const STALL_THRESHOLD_MS = 5 * 60 * 1000

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

export default async function handler(req, res) {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) return res.status(503).json({ error: 'CRON_SECRET not configured' })
  if (req.headers?.authorization !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: 'unauthorized' })
  }
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return res.status(503).json({ error: 'Supabase env not configured' })
  }

  const staleBefore = new Date(Date.now() - STALL_THRESHOLD_MS).toISOString()

  // Step 1: package_ids that have a stalled (no recent activity), not-yet-done
  // piece. Two plain queries instead of a PostgREST embed-filter — more robust.
  const r = await sb(
    `story_package_chunks?status=in.(pending,rendering)&updated_at=lt.${staleBefore}&select=package_id`,
  )
  if (!r.ok) {
    const text = await r.text().catch(() => '')
    console.error('[resume-longform] chunk query failed:', r.status, text)
    return res.status(500).json({ error: 'query_failed' })
  }
  const stalledRows = await r.json().catch(() => [])
  const candidateIds = [...new Set((Array.isArray(stalledRows) ? stalledRows : []).map((x) => x.package_id))]

  // Step 2: keep only those whose parent package is still generating (skip
  // canceled/settled). Empty candidate set → nothing to do.
  let packageIds = []
  if (candidateIds.length) {
    const inList = candidateIds.map((id) => `"${id}"`).join(',')
    const pr = await sb(`story_packages?id=in.(${inList})&status=eq.generating&select=id`)
    if (!pr.ok) {
      const text = await pr.text().catch(() => '')
      console.error('[resume-longform] package query failed:', pr.status, text)
      return res.status(500).json({ error: 'query_failed' })
    }
    const pkgRows = await pr.json().catch(() => [])
    packageIds = (Array.isArray(pkgRows) ? pkgRows : []).map((x) => x.id)
  }

  const proto = req.headers['x-forwarded-proto'] || 'https'
  const host = req.headers.host
  const baseUrl = host ? `${proto}://${host}` : null

  let resumed = 0
  for (const packageId of packageIds) {
    if (!baseUrl) break
    try {
      await fetch(`${baseUrl}/api/editorial/render-longform-worker`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${cronSecret}` },
        body: JSON.stringify({ packageId }),
      })
      resumed += 1
    } catch (e) {
      console.error(`[resume-longform] re-kick failed for ${packageId}:`, e?.message || e)
    }
  }

  return res.status(200).json({ checked: packageIds.length, resumed })
}
