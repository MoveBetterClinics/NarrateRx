import { withSentry } from '../_lib/sentry.js'
// Create a new collection. Editor or admin only — clinicians don't curate
// collections. Slugs are derived from name when not provided; uniqueness is
// enforced at the DB layer (unique on brand+slug).

import { requireRole } from '../_lib/auth.js'
import { STAFF_ROLES } from '../_lib/roles.js'
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
      Prefer: 'return=representation',
      ...init.headers,
    },
  })
}

function slugify(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
}

const ALLOWED_KINDS = new Set(['campaign', 'series', 'session', 'adhoc'])

async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const auth = await requireRole(req, STAFF_ROLES)
  if (!auth.ok) {
    return res.status(auth.reason === 'forbidden' ? 403 : 401).json({ error: auth.reason })
  }

  const body = req.body || {}
  const name = String(body.name || '').trim()
  if (!name) return res.status(400).json({ error: 'name required' })

  const slug = slugify(body.slug || name) || null
  const kind = ALLOWED_KINDS.has(body.kind) ? body.kind : 'campaign'

  const scope = await workspaceScope(req)
  const row = {
    [scope.column]: scope.id,
    name,
    slug,
    description: body.description || null,
    kind,
    cover_asset_id: body.coverAssetId || null,
    status: 'active',
    created_by: auth.userId || null,
  }

  const r = await sb('collections', { method: 'POST', body: JSON.stringify(row) })
  if (!r.ok) {
    const text = await r.text()
    // 23505 = unique violation on (brand, slug).
    if (text.includes('23505')) {
      return res.status(409).json({ error: 'A collection with that slug already exists', detail: text })
    }
    return res.status(500).json({ error: 'Insert failed', detail: text })
  }
  const data = await r.json()
  return res.status(200).json(data[0] ?? null)
}

export default withSentry(handler)
