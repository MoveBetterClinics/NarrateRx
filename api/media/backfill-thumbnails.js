import { withSentry } from '../_lib/sentry.js'
import { generateAndPersistThumbnail } from '../_lib/thumbnail.js'
import { requireRole } from '../_lib/auth.js'
import { workspaceScope } from '../_lib/workspaceScope.js'

// One-shot backfill: extract thumbnails for any video in this workspace that
// has blob_url set but thumbnail_url null. Safe to re-run — the WHERE filters
// out videos that already got thumbnails on a previous pass.
//
// Routing: POST /api/media/backfill-thumbnails
// Body:    { limit?: number }   default 25, max 100
// Response: { processed, succeeded, failed, errors: [{ id, message }] }
//
// Sequential (not parallel) so a single misbehaving video can't pile up
// concurrent ffmpeg invocations and exhaust the function's /tmp budget.

export const config = { runtime: 'nodejs', maxDuration: 300 }

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY

const DEFAULT_LIMIT = 10
const MAX_LIMIT     = 25
// Stop picking up new videos once we've burned this much wall-clock. Leaves
// ~60s of slack under the 300s maxDuration so the in-flight video has room
// to finish and the response can flush before Vercel's gateway 504s.
const DEADLINE_MS   = 240_000

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

async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const requested = Number(req.body?.limit) || DEFAULT_LIMIT
  const limit = Math.max(1, Math.min(MAX_LIMIT, requested))

  const scope = await workspaceScope(req)

  const auth = await requireRole(req, ['admin'], { orgId: scope.workspace.clerk_org_id })
  if (!auth.ok) {
    return res.status(auth.reason === 'forbidden' ? 403 : 401).json({ error: auth.reason })
  }
  // Order by created_at asc so successive runs naturally walk forward through
  // the backlog. Each pass picks up the next chunk of un-thumbnailed videos.
  const query = `media_assets?${scope.column}=eq.${scope.id}&kind=eq.video&thumbnail_url=is.null&blob_url=not.is.null&select=id,${scope.column},kind,blob_url&order=created_at.asc&limit=${limit}`

  const lookup = await sb(query)
  if (!lookup.ok) {
    return res.status(500).json({ error: `Lookup failed: ${lookup.status}` })
  }
  const candidates = await lookup.json()

  let succeeded = 0
  let failed = 0
  let processed = 0
  const errors = []
  const startedAt = Date.now()

  for (const asset of candidates) {
    // Wall-clock guard: a single large video can take 30s+ end-to-end, so a
    // count-based cap isn't enough to keep the function under 300s. Bail
    // before starting another one if we've crossed the deadline; the client
    // loops until processed=0 so the next request will pick up where this
    // one left off.
    if (Date.now() - startedAt > DEADLINE_MS) break
    processed += 1
    try {
      await generateAndPersistThumbnail(asset, scope)
      succeeded += 1
    } catch (e) {
      failed += 1
      errors.push({ id: asset.id, message: e?.message || 'failed' })
      console.error('[backfill-thumbnails]', asset.id, e?.message)
    }
  }

  return res.status(200).json({
    processed,
    succeeded,
    failed,
    errors,
  })
}

export default withSentry(handler)
