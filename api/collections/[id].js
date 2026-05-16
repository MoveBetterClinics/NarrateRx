import { withSentry } from '../_lib/sentry.js'
// GET / PATCH / DELETE for a single collection.
//   GET    → any authenticated user; embeds the asset list (id, blob_url,
//            thumbnail_url, kind, status, filename) so the detail view can
//            render without a second hop.
//   PATCH  → admin or publisher; rename, re-describe, change cover, archive.
//   DELETE → admin or publisher; cascades collection_items but leaves assets.

import { requireRole } from '../_lib/auth.js'
import { STAFF_ROLES } from '../_lib/roles.js'
import { workspaceScope } from '../_lib/workspaceScope.js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY

const ROLE_REQUIREMENTS = {
  GET:    null,
  PATCH:  STAFF_ROLES,
  DELETE: STAFF_ROLES,
}

const ALLOWED_KINDS    = new Set(['campaign', 'series', 'session', 'adhoc'])
const ALLOWED_STATUSES = new Set(['active', 'archived'])

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

const SELECT_COMMON =
  'name,slug,description,kind,cover_asset_id,status,' +
  'created_at,updated_at,created_by,' +
  'collection_items(asset_id,position,added_at,added_by,' +
  'media_assets(id,kind,status,filename,blob_url,thumbnail_url,duration_s,aspect_ratio))'

async function handler(req, res) {
  if (!(req.method in ROLE_REQUIREMENTS)) {
    return res.status(405).json({ error: 'Method not allowed' })
  }
  const auth = await requireRole(req, ROLE_REQUIREMENTS[req.method])
  if (!auth.ok) {
    return res.status(auth.reason === 'forbidden' ? 403 : 401).json({ error: auth.reason })
  }

  const url = new URL(req.url, 'http://localhost')
  const id  = url.pathname.split('/').pop()
  if (!id) return res.status(400).json({ error: 'Missing id' })

  const scope = await workspaceScope(req)
  const SELECT = `id,${scope.column},${SELECT_COMMON}`
  const where = `id=eq.${id}&${scope.column}=eq.${scope.id}`

  if (req.method === 'GET') {
    const r = await sb(`collections?${where}&select=${SELECT}`)
    if (!r.ok) {
      const text = await r.text()
      return res.status(500).json({ error: 'Database error', detail: text })
    }
    const rows = await r.json()
    const row  = rows[0]
    if (!row) return res.status(404).json({ error: 'Not found' })

    // Flatten the embedded items into a clean array of assets with item meta.
    const items = (row.collection_items || [])
      .map((ci) => ({
        asset_id: ci.asset_id,
        position: ci.position,
        added_at: ci.added_at,
        added_by: ci.added_by,
        asset:    ci.media_assets || null,
      }))
      .sort((a, b) => {
        const ap = a.position ?? Number.POSITIVE_INFINITY
        const bp = b.position ?? Number.POSITIVE_INFINITY
        if (ap !== bp) return ap - bp
        return new Date(a.added_at) - new Date(b.added_at)
      })

    const { collection_items: _ci, ...rest } = row
    return res.status(200).json({ ...rest, items, item_count: items.length })
  }

  if (req.method === 'PATCH') {
    const patch = req.body || {}
    const allowed = {
      name:           patch.name,
      slug:           patch.slug,
      description:    patch.description,
      kind:           patch.kind && ALLOWED_KINDS.has(patch.kind)       ? patch.kind   : undefined,
      cover_asset_id: patch.coverAssetId,
      status:         patch.status && ALLOWED_STATUSES.has(patch.status) ? patch.status : undefined,
    }
    const body = Object.fromEntries(Object.entries(allowed).filter(([, v]) => v !== undefined))
    if (Object.keys(body).length === 0) {
      return res.status(400).json({ error: 'No editable fields in patch' })
    }

    const r = await sb(`collections?${where}`, {
      method: 'PATCH',
      body:   JSON.stringify(body),
    })
    if (!r.ok) {
      const text = await r.text()
      if (text.includes('23505')) {
        return res.status(409).json({ error: 'A collection with that slug already exists', detail: text })
      }
      return res.status(500).json({ error: 'Update failed', detail: text })
    }
    const data = await r.json()
    return res.status(200).json(data[0] ?? null)
  }

  if (req.method === 'DELETE') {
    const r = await sb(`collections?${where}`, { method: 'DELETE' })
    if (!r.ok) {
      const text = await r.text()
      return res.status(500).json({ error: 'Delete failed', detail: text })
    }
    return res.status(200).json({ deleted: true })
  }

  return res.status(405).json({ error: 'Method not allowed' })
}

export default withSentry(handler)
