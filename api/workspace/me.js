// Workspace profile endpoint.
//
// GET  — returns the active workspace row (resolved from Host header). No auth required.
// PATCH — updates tenant-editable fields on the workspace row. Requires Clerk admin role.
//
// 404 when no resolvable workspace (apex, www, preview URL, unknown subdomain).

import { workspaceContext } from '../_lib/workspaceContext.js'
import { requireRole } from '../_lib/auth.js'

// Hard allowlist — only these columns may be patched via this endpoint.
// slug, clerk_org_id, capabilities, status are developer-owned.
const PATCHABLE_FIELDS = new Set([
  'display_name', 'tagline', 'sign_in_blurb',
  'website', 'location', 'region',
  'clinic_context', 'audience_short', 'brand_voice', 'booking_url',
  'internal_links_markdown', 'signature_system_name', 'signature_system_url',
  'social',
  'app_name', 'region_short', 'website_hostname', 'link_preview_blurb',
  'audience_description', 'activity_context',
  'pinterest_boards', 'location_keyword', 'location_hashtag', 'brand_hashtag',
  'spoken_url',
  'enabled_outputs',
  'logo', 'colors', 'brandbook',
])

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

export default async function handler(req, res) {
  if (req.method === 'GET') {
    const workspace = await workspaceContext(req)
    if (!workspace) return res.status(404).json({ error: 'no-workspace-context' })

    // Attach active workspace_locations so the SPA can render the per-post
    // location picker without an extra round trip. Locations are not secret —
    // the same identity (city/region/hashtag) is already interpolated into
    // public-facing copy via prompts. Failing the locations fetch is non-fatal
    // (legacy workspaces with the table absent get [] and degrade to single-
    // location behavior).
    let locations = []
    try {
      const lr = await sb(
        `workspace_locations?workspace_id=eq.${encodeURIComponent(workspace.id)}&status=eq.active&select=*&order=position.asc`
      )
      if (lr.ok) {
        const rows = await lr.json().catch(() => [])
        locations = Array.isArray(rows) ? rows : []
      }
    } catch (e) {
      console.error('[workspace/me] locations fetch failed:', e?.message)
    }

    res.setHeader('Cache-Control', 'private, no-store')
    return res.status(200).json({ ...workspace, locations })
  }

  if (req.method === 'PATCH') {
    const auth = await requireRole(req, ['admin'])
    if (!auth.ok) {
      const status = auth.reason === 'forbidden' ? 403 : 401
      return res.status(status).json({ error: auth.reason })
    }

    const workspace = await workspaceContext(req)
    if (!workspace) return res.status(404).json({ error: 'no-workspace-context' })

    const body = req.body || {}
    const patch = {}
    for (const [key, value] of Object.entries(body)) {
      if (PATCHABLE_FIELDS.has(key)) patch[key] = value
    }
    if (Object.keys(patch).length === 0) {
      return res.status(400).json({ error: 'no-patchable-fields' })
    }

    let r
    try {
      r = await sb(
        `workspaces?id=eq.${encodeURIComponent(workspace.id)}`,
        {
          method: 'PATCH',
          headers: { Prefer: 'return=representation' },
          body: JSON.stringify(patch),
        },
      )
    } catch (e) {
      console.error('[workspace/me PATCH] network error:', e?.message)
      return res.status(500).json({ error: 'db-error' })
    }

    if (!r.ok) {
      const text = await r.text().catch(() => '')
      console.error(`[workspace/me PATCH] supabase ${r.status}:`, text)
      return res.status(500).json({ error: 'db-error' })
    }

    const rows = await r.json().catch(() => null)
    const updated = Array.isArray(rows) ? rows[0] : null
    if (!updated) return res.status(500).json({ error: 'db-error' })
    return res.status(200).json(updated)
  }

  return res.status(405).json({ error: 'method-not-allowed' })
}
