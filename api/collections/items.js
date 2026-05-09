// Add or remove media_assets from a collection.
//
//   POST   { collectionId, assetIds: [...] }       → add many at once
//   DELETE ?collectionId=...&assetId=...           → remove one
//   DELETE { collectionId, assetIds: [...] }       → remove many at once
//
// Add is idempotent — duplicates collapse onto the (collection_id, asset_id)
// composite primary key. We verify both the collection and every asset
// belong to the current workspace before touching the junction so a leaked id
// from another workspace can't cross-link rows.

import { requireRole } from '../_lib/auth.js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY

function workspaceId() {
  return (process.env.BRAND || process.env.VITE_BRAND || 'people').toLowerCase()
}

function sb(path, init = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation,resolution=ignore-duplicates',
      ...init.headers,
    },
  })
}

async function verifyBrand(table, ids) {
  if (!ids?.length) return { ok: true, missing: [] }
  const idList = ids.map(encodeURIComponent).join(',')
  const r = await sb(`${table}?id=in.(${idList})&brand=eq.${workspaceId()}&select=id`)
  if (!r.ok) return { ok: false, error: 'lookup-failed' }
  const rows = await r.json()
  const found = new Set(rows.map((row) => row.id))
  const missing = ids.filter((id) => !found.has(id))
  return { ok: missing.length === 0, missing }
}

export default async function handler(req, res) {
  if (req.method !== 'POST' && req.method !== 'DELETE') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const auth = await requireRole(req, ['admin', 'editor'])
  if (!auth.ok) {
    return res.status(auth.reason === 'forbidden' ? 403 : 401).json({ error: auth.reason })
  }

  const { searchParams } = new URL(req.url, 'http://localhost')
  const body = req.body || {}

  const collectionId = body.collectionId || searchParams.get('collectionId')
  if (!collectionId) return res.status(400).json({ error: 'collectionId required' })

  // Always confirm the collection belongs to this workspace.
  const colCheck = await verifyBrand('collections', [collectionId])
  if (!colCheck.ok) return res.status(404).json({ error: 'Collection not found' })

  if (req.method === 'POST') {
    const assetIds = Array.isArray(body.assetIds) ? body.assetIds.filter(Boolean) : []
    if (!assetIds.length) return res.status(400).json({ error: 'assetIds[] required' })

    const assetCheck = await verifyBrand('media_assets', assetIds)
    if (!assetCheck.ok) {
      return res.status(404).json({ error: 'One or more assets not found', missing: assetCheck.missing })
    }

    const rows = assetIds.map((id) => ({
      collection_id: collectionId,
      asset_id:      id,
      added_by:      auth.userId || null,
    }))

    const r = await sb('collection_items', { method: 'POST', body: JSON.stringify(rows) })
    if (!r.ok) {
      const text = await r.text()
      return res.status(500).json({ error: 'Insert failed', detail: text })
    }
    const data = await r.json()
    return res.status(200).json({ added: data.length, items: data })
  }

  // DELETE — single via query, bulk via body.
  const singleAssetId = searchParams.get('assetId')
  const assetIds = singleAssetId
    ? [singleAssetId]
    : (Array.isArray(body.assetIds) ? body.assetIds.filter(Boolean) : [])

  if (!assetIds.length) return res.status(400).json({ error: 'assetId or assetIds[] required' })

  const idList = assetIds.map(encodeURIComponent).join(',')
  const r = await sb(`collection_items?collection_id=eq.${collectionId}&asset_id=in.(${idList})`, {
    method: 'DELETE',
  })
  if (!r.ok) {
    const text = await r.text()
    return res.status(500).json({ error: 'Delete failed', detail: text })
  }
  return res.status(200).json({ removed: assetIds.length })
}
