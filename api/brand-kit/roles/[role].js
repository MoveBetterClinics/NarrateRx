import { withSentry } from '../../_lib/sentry.js'
export const config = { runtime: 'nodejs' }
import { requireRole } from '../../_lib/auth.js'
import { EDITOR_ROLES } from '../../_lib/roles.js'
import { workspaceScope } from '../../_lib/workspaceScope.js'
import { invalidateWorkspaceCacheById } from '../../_lib/workspaceContext.js'

// Assign or clear a role within the current workspace's Brand Kit.
//
//   PUT    /api/brand-kit/roles/primary_logo  body: { assetId }
//   DELETE /api/brand-kit/roles/primary_logo
//
// PUT performs an upsert: setting a role re-points the slot at a new asset
// (no need for a separate "is this slot filled?" check). DELETE is the
// "Clear" button in the Roles panel.
//
// The role string in the path is the application-side enum-by-convention.
// We validate it against a fixed list rather than trusting whatever the
// client sends — an attacker who could write arbitrary role strings could
// plant junk slots and stuff the response payload for downstream consumers.

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY

const VALID_ROLES = new Set([
  'primary_logo','mark_only','wordmark_only',
  'logo_on_light','logo_on_dark',
  'favicon','social_avatar','social_cover',
  'brand_book',
])

const ROLE_WRITE_ROLES = EDITOR_ROLES

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
  const role = req.query?.role
  if (!role || !VALID_ROLES.has(role)) {
    return res.status(400).json({ error: `Unknown role: ${role}` })
  }

  const scope = await workspaceScope(req)

  const auth = await requireRole(req, ROLE_WRITE_ROLES, { orgId: scope.workspace.clerk_org_id })
  if (!auth.ok) return res.status(auth.reason === 'forbidden' ? 403 : 401).json({ error: auth.reason })

  if (req.method === 'PUT') {
    const { assetId } = req.body || {}
    if (!assetId) return res.status(400).json({ error: 'assetId required' })

    // Defense-in-depth: verify the asset belongs to this workspace before
    // pointing the role at it. The FK on brand_kit_roles.asset_id only
    // enforces "asset exists" — not "asset belongs to your workspace" — so
    // without this check a caller could plant a foreign workspace's logo
    // into their own Brand Kit by passing its id.
    const own = await sb(`brand_assets?select=id&id=eq.${encodeURIComponent(assetId)}&${scope.column}=eq.${scope.id}&limit=1`)
    if (!own.ok) return res.status(500).json({ error: 'Database error (own-check)' })
    const ownRows = await own.json()
    if (!ownRows[0]) return res.status(404).json({ error: 'Asset not found in this workspace' })

    // Upsert via PostgREST: the composite PK (workspace_id, role) means the
    // on-conflict resolution targets exactly one row.
    const upRes = await sb(`brand_kit_roles?on_conflict=workspace_id,role`, {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
      body: JSON.stringify({
        [scope.column]: scope.id,
        role,
        asset_id: assetId,
        assigned_by: auth.userId || null,
        assigned_at: new Date().toISOString(),
      }),
    })
    if (!upRes.ok) {
      const text = await upRes.text()
      return res.status(500).json({ error: 'Database error (upsert)', detail: text })
    }
    const row = await upRes.json()

    // When the brand book is assigned, sync its extracted guidelines to the
    // workspace row so prompts can read them without a separate brand-kit query.
    if (role === 'brand_book') {
      const assetRes = await sb(`brand_assets?select=ai_classification&id=eq.${encodeURIComponent(assetId)}&limit=1`)
      if (assetRes.ok) {
        const assetRows = await assetRes.json()
        const cls = assetRows?.[0]?.ai_classification || {}
        if (cls.extracted_guidelines) {
          await sb(`workspaces?id=eq.${scope.id}`, {
            method: 'PATCH',
            headers: { Prefer: 'return=minimal' },
            body: JSON.stringify({ brand_guidelines: cls.extracted_guidelines }),
          })
        }
        if (cls.extracted_style && Object.keys(cls.extracted_style).length > 0) {
          const wsRow = await sb(`workspaces?id=eq.${scope.id}&select=brand_style`)
          const currentStyle = wsRow.ok ? ((await wsRow.json())?.[0]?.brand_style || {}) : {}
          const nextStyle = { ...currentStyle, ...cls.extracted_style }
          await sb(`workspaces?id=eq.${scope.id}`, {
            method: 'PATCH',
            headers: { Prefer: 'return=minimal' },
            body: JSON.stringify({ brand_style: nextStyle }),
          })
          invalidateWorkspaceCacheById(scope.id)
        }
      }
    }

    return res.status(200).json({ ok: true, row: row?.[0] || null })
  }

  if (req.method === 'DELETE') {
    const delRes = await sb(`brand_kit_roles?${scope.column}=eq.${scope.id}&role=eq.${encodeURIComponent(role)}`, { method: 'DELETE' })
    if (!delRes.ok) return res.status(500).json({ error: 'Database error (delete)' })
    return res.status(200).json({ ok: true })
  }

  return res.status(405).json({ error: 'Method not allowed' })
}

export default withSentry(handler)
