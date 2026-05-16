import { withSentry } from '../_lib/sentry.js'
import { requireRole } from '../_lib/auth.js'
import { workspaceScope } from '../_lib/workspaceScope.js'

// Combined read for the Brand Kit UI — returns the asset library, the current
// role → asset mapping, and the workspace's brand_style jsonb in a single
// round-trip. The component renders all three in one view so collapsing to one
// call avoids the loading-cascade flicker we'd otherwise get from three.
//
// Runs on Node (Fluid Compute) using the (req, res) handler shape — same as
// every other workspace-scoped DB route on this deployment.

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

const ASSET_COLS = 'id,blob_url,blob_pathname,mime_type,byte_size,original_filename,width,height,has_alpha,shape,background,color_mode,filename_tokens,ai_classification,user_tags,uploaded_by,uploaded_at'

async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  const scope = await workspaceScope(req)

  const auth = await requireRole(req, null, { orgId: scope.workspace.clerk_org_id })
  if (!auth.ok) return res.status(auth.reason === 'forbidden' ? 403 : 401).json({ error: auth.reason })

  // Three parallel reads — assets, roles, and the brand_style column on the
  // workspace row. brand_style lives on workspaces (not its own table) because
  // it's a small JSON blob of non-file state that already had a natural home.
  const [assetsRes, rolesRes] = await Promise.all([
    sb(`brand_assets?select=${ASSET_COLS}&${scope.column}=eq.${scope.id}&order=uploaded_at.desc`),
    sb(`brand_kit_roles?select=role,asset_id,assigned_at&${scope.column}=eq.${scope.id}`),
  ])
  if (!assetsRes.ok) return res.status(500).json({ error: 'Database error (assets)' })
  if (!rolesRes.ok)  return res.status(500).json({ error: 'Database error (roles)' })

  const [assets, roleRows] = await Promise.all([assetsRes.json(), rolesRes.json()])

  // Roles come back as rows; flatten to a { role: asset_id } map for the UI.
  const roles = {}
  for (const r of roleRows) roles[r.role] = r.asset_id

  // brand_style is already on scope.workspace (workspaceContext fetched it).
  const style = scope.workspace?.brand_style || {}

  return res.status(200).json({ assets, roles, style })
}

export default withSentry(handler)
