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

export const config = { maxDuration: 300 }

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY

const DEFAULT_LIMIT = 25
const MAX_LIMIT     = 100

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

  const auth = await requireRole(req, ['admin'])
  if (!auth.ok) {
    return res.status(auth.reason === 'forbidden' ? 403 : 401).json({ error: auth.reason })
  }

  const requested = Number(req.body?.limit) || DEFAULT_LIMIT
  const limit = Math.max(1, Math.min(MAX_LIMIT, requested))

  const scope = await workspaceScope(req)
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
  const errors = []

  for (const asset of candidates) {
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
    processed: candidates.length,
    succeeded,
    failed,
    errors,
  })
}

export default withSentry(handler)
