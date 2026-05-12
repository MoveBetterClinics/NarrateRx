import { withSentry } from '../_lib/sentry.js'
// List collections for the current workspace. Editor-side groupings of
// media_assets — campaigns, series, ad-hoc bundles. Filter by status (active
// is the default; archived must be opted into) and kind. Includes a count of
// items per collection so the UI can show "12 items" without a second hop.

import { requireRole } from '../_lib/auth.js'
import { workspaceScope } from '../_lib/workspaceScope.js'

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

const SELECT_COMMON =
  'name,slug,description,kind,cover_asset_id,status,' +
  'created_at,updated_at,created_by,' +
  'collection_items(count)'

async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const auth = await requireRole(req)
  if (!auth.ok) {
    return res.status(auth.reason === 'forbidden' ? 403 : 401).json({ error: auth.reason })
  }

  const { searchParams } = new URL(req.url, 'http://localhost')
  const status  = searchParams.get('status')   // active (default) | archived | all
  const kind    = searchParams.get('kind')     // campaign | series | session | adhoc
  const assetId = searchParams.get('assetId')  // limit to collections containing this asset
  const limit   = Math.min(parseInt(searchParams.get('limit') || '100'), 500)
  const offset  = parseInt(searchParams.get('offset') || '0')

  const scope = await workspaceScope(req)
  const SELECT = `id,${scope.column},${SELECT_COMMON}`

  // Resolve an assetId membership filter into a collection-id whitelist
  // before composing the main query. Verify the asset belongs to this
  // workspace first — collection_items has no workspace_id of its own
  // (tenant scope inherited via FKs), and the final collections filter
  // would silently turn into a leak if a future refactor drops it.
  let membershipCollectionIds = null
  if (assetId) {
    const ownRes = await sb(`media_assets?id=eq.${encodeURIComponent(assetId)}&${scope.column}=eq.${scope.id}&select=id&limit=1`)
    if (!ownRes.ok) return res.status(500).json({ error: 'Database error' })
    const ownRows = await ownRes.json()
    if (!ownRows[0]) return res.status(200).json([])
    const ciRes = await sb(`collection_items?asset_id=eq.${encodeURIComponent(assetId)}&select=collection_id`)
    if (!ciRes.ok) return res.status(500).json({ error: 'Database error' })
    const ciRows = await ciRes.json()
    membershipCollectionIds = ciRows.map((r) => r.collection_id)
    if (membershipCollectionIds.length === 0) return res.status(200).json([])
  }

  let qs = `collections?select=${SELECT}&${scope.column}=eq.${scope.id}&order=created_at.desc&limit=${limit}&offset=${offset}`
  if (kind) qs += `&kind=eq.${kind}`
  if (status === 'archived') {
    qs += `&status=eq.archived`
  } else if (status !== 'all') {
    qs += `&status=eq.active`
  }
  if (membershipCollectionIds) {
    qs += `&id=in.(${membershipCollectionIds.map(encodeURIComponent).join(',')})`
  }

  const r = await sb(qs)
  if (!r.ok) {
    const text = await r.text()
    return res.status(500).json({ error: 'Database error', detail: text })
  }
  const rows = await r.json()
  // Flatten the embedded count for cleaner client consumption.
  const out = rows.map((row) => {
    const itemCount = row.collection_items?.[0]?.count ?? 0
    const { collection_items, ...rest } = row
    return { ...rest, item_count: itemCount }
  })
  return res.status(200).json(out)
}

export default withSentry(handler)
