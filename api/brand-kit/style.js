import { withSentry } from '../_lib/sentry.js'
export const config = { runtime: 'nodejs' }
import { requireRole } from '../_lib/auth.js'
import { STAFF_ROLES } from '../_lib/roles.js'
import { workspaceScope } from '../_lib/workspaceScope.js'
import { invalidateWorkspaceCacheById } from '../_lib/workspaceContext.js'

// Patch the workspace's brand_style jsonb. Accent color, secondary palette,
// and heading/body font names — see migration 023 for the canonical shape.
//
// We validate the shape strictly rather than blindly merging the request body
// into the column: brand_style is read by the rendering layer (email, social
// cards, Astro publish) and a malformed value there silently corrupts every
// future post. The client may send any subset of fields; unknown fields are
// rejected (not silently dropped) so a misspelled key surfaces as an error.

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY

const STYLE_WRITE_ROLES = STAFF_ROLES

const HEX_RE = /^#[0-9a-fA-F]{6}$/

function validate(patch) {
  if (typeof patch !== 'object' || !patch) return { ok: false, error: 'body must be an object' }
  const allowed = ['accent_color', 'secondary_colors', 'heading_font', 'body_font']
  for (const k of Object.keys(patch)) {
    if (!allowed.includes(k)) return { ok: false, error: `unknown field: ${k}` }
  }
  if (patch.accent_color != null && !HEX_RE.test(patch.accent_color)) {
    return { ok: false, error: 'accent_color must be #RRGGBB' }
  }
  if (patch.secondary_colors != null) {
    if (!Array.isArray(patch.secondary_colors)) return { ok: false, error: 'secondary_colors must be an array' }
    for (const c of patch.secondary_colors) {
      if (typeof c !== 'string' || !HEX_RE.test(c)) return { ok: false, error: 'secondary_colors entries must be #RRGGBB' }
    }
  }
  for (const fontKey of ['heading_font', 'body_font']) {
    if (patch[fontKey] != null && (typeof patch[fontKey] !== 'string' || patch[fontKey].length > 80)) {
      return { ok: false, error: `${fontKey} must be a string ≤80 chars` }
    }
  }
  return { ok: true }
}

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
  if (req.method !== 'PATCH') return res.status(405).json({ error: 'Method not allowed' })

  const patch = req.body || {}
  const validation = validate(patch)
  if (!validation.ok) return res.status(400).json({ error: validation.error })

  const scope = await workspaceScope(req)

  const auth = await requireRole(req, STYLE_WRITE_ROLES, { orgId: scope.workspace.clerk_org_id })
  if (!auth.ok) return res.status(auth.reason === 'forbidden' ? 403 : 401).json({ error: auth.reason })
  const current = scope.workspace?.brand_style || {}
  const next = { ...current, ...patch }

  const upRes = await sb(`workspaces?id=eq.${scope.id}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ brand_style: next }),
  })
  if (!upRes.ok) {
    const text = await upRes.text()
    return res.status(500).json({ error: 'Database error', detail: text })
  }
  // Drop the workspace cache so the next GET in this instance reflects the
  // write. Without this the 60s in-process cache serves stale brand_style.
  invalidateWorkspaceCacheById(scope.id)
  return res.status(200).json({ ok: true, style: next })
}

export default withSentry(handler)
