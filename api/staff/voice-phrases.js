// GET /api/staff/voice-phrases?staff_id=<uuid>&limit=<n>
//
// Returns the structured voice substrate for a single clinician — the
// frequency-weighted phrases that future phases (auto-tune, diff annotations,
// freshness UI) will read and write. Today this is read-only and the table is
// empty for every clinician; writes land in follow-up PRs.
//
// Tenant isolation: workspaceScope(req) resolves the workspace from the host,
// every query filters by workspace_id, and the clinician existence-check is
// scoped to the same workspace so cross-workspace staff_ids return 404.

export const config = { runtime: 'nodejs' }

import { withSentry } from '../_lib/sentry.js'
import { requireRole } from '../_lib/auth.js'
import { workspaceScope } from '../_lib/workspaceScope.js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY

const DEFAULT_LIMIT = 50
const MAX_LIMIT = 200

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

async function dbErr(res, r, msg) {
  let body = ''
  try { body = await r.text() } catch { /* ignore */ }
  console.error(`[clinicians/voice-phrases] ${msg} status=${r.status} body=${body.slice(0, 500)}`)
  return res.status(500).json({ error: 'Database error' })
}

async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  const scope = await workspaceScope(req)
  const { id: workspaceId } = scope

  const auth = await requireRole(req, null, { orgId: scope.workspace.clerk_org_id })
  if (!auth.ok) return res.status(auth.reason === 'forbidden' ? 403 : 401).json({ error: auth.reason })

  const url = new URL(req.url, 'http://localhost')
  const staffId = url.searchParams.get('staff_id')
  if (!staffId) return res.status(400).json({ error: 'Missing staff_id' })

  const limitRaw = parseInt(url.searchParams.get('limit') || '', 10)
  const limit = Number.isFinite(limitRaw) && limitRaw > 0
    ? Math.min(limitRaw, MAX_LIMIT)
    : DEFAULT_LIMIT

  // Scope the clinician lookup to this workspace so cross-tenant ids 404.
  const clinRes = await sb(
    `staff?id=eq.${staffId}&workspace_id=eq.${workspaceId}&select=id`
  )
  if (!clinRes.ok) return dbErr(res, clinRes, 'clinician lookup failed')
  const clinRows = await clinRes.json()
  if (!clinRows.length) return res.status(404).json({ error: 'Clinician not found' })

  // Three parallel queries: the top-N phrase rows, the total-count + last-seen
  // summary, and the distinct-approved-pieces count. The last two power the
  // voice-freshness card ("trained on N pieces, last updated X").
  const [phrasesRes, summaryRes, piecesRes] = await Promise.all([
    sb(
      `staff_voice_phrases?staff_id=eq.${staffId}&workspace_id=eq.${workspaceId}` +
      `&select=phrase,weight,approve_count,reject_count,first_seen_at,last_seen_at` +
      `&order=weight.desc,last_seen_at.desc` +
      `&limit=${limit}`
    ),
    // count=exact via Prefer header puts the total in Content-Range. Cheaper
    // than fetching every row just to .length it.
    sb(
      `staff_voice_phrases?staff_id=eq.${staffId}&workspace_id=eq.${workspaceId}` +
      `&select=last_seen_at&order=last_seen_at.desc&limit=1`,
      { headers: { Prefer: 'count=exact' } }
    ),
    // Approved content_items used to grow this voice profile. Approximate —
    // doesn't reflect content_items that produced zero voice-worthy phrases.
    sb(
      `content_items?staff_id=eq.${staffId}&workspace_id=eq.${workspaceId}` +
      `&status=in.(approved,published)&select=id&limit=1`,
      { headers: { Prefer: 'count=exact' } }
    ),
  ])
  if (!phrasesRes.ok) return dbErr(res, phrasesRes, 'phrases query failed')
  if (!summaryRes.ok) return dbErr(res, summaryRes, 'summary query failed')
  if (!piecesRes.ok)  return dbErr(res, piecesRes,  'pieces count failed')

  const phrases     = await phrasesRes.json()
  const summaryRows = await summaryRes.json()

  // Content-Range comes back as "0-0/N" (or "*/0" when the resource is empty).
  function parseCount(rangeHeader) {
    if (!rangeHeader) return 0
    const m = rangeHeader.match(/\/(\d+)$/)
    return m ? parseInt(m[1], 10) : 0
  }
  const totalPhrases  = parseCount(summaryRes.headers.get('Content-Range'))
  const piecesCount   = parseCount(piecesRes.headers.get('Content-Range'))
  const lastUpdatedAt = summaryRows[0]?.last_seen_at ?? null

  return res.status(200).json({
    staff_id:    staffId,
    count:           phrases.length,
    limit,
    total_phrases:   totalPhrases,
    pieces_count:    piecesCount,
    last_updated_at: lastUpdatedAt,
    phrases,
  })
}

export default withSentry(handler)
