// GET  /api/carousel-themes   — list built-ins + workspace custom themes
// POST /api/carousel-themes   — create a new custom theme { name, is_default, config }
export const config = { runtime: 'nodejs' }

import { workspaceContext } from '../_lib/workspaceContext.js'
import { requireRole, requireCapability } from '../_lib/auth.js'
import { EDITOR_ROLES } from '../_lib/roles.js'
import { CAP_SETTINGS_EDIT } from '../_lib/capabilities.js'
import { enforceLimit } from '../_lib/ratelimit.js'
import { BUILTIN_THEMES } from '../../src/lib/carouselThemes.js'

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

const ok  = (res, data, status = 200) => res.status(status).json(data)
const err = (res, msg, status = 400)  => res.status(status).json({ error: msg })

async function dbErr(res, r, msg = 'Database error') {
  const body = await r.text().catch(() => '')
  console.error(`[carousel-themes] ${msg} — supabase ${r.status}: ${body.slice(0, 300)}`)
  return res.status(500).json({ error: msg })
}

export default async function handler(req, res) {
  const ws = await workspaceContext(req)
  if (!ws) return err(res, 'Workspace not resolved', 400)

  const allowedRoles = req.method === 'GET' ? null : EDITOR_ROLES
  const auth = await requireRole(req, allowedRoles, { orgId: ws.clerk_org_id })
  if (!auth.ok) {
    return res.status(auth.reason === 'forbidden' ? 403 : 401).json({ error: auth.reason })
  }

  // Phase 4 PR1: settings capability gate on writes (carousel themes are workspace
  // settings — producer is blocked by default template).
  if (req.method !== 'GET') {
    const capAuth = await requireCapability(req, ws, [CAP_SETTINGS_EDIT])
    if (!capAuth.ok) {
      return res.status(403).json({ error: capAuth.reason, missing: capAuth.missing })
    }
  }

  if (req.method === 'GET') {
    const r = await sb(
      `workspace_carousel_themes?workspace_id=eq.${ws.id}&select=id,name,is_default,config,created_at&order=created_at.asc`
    )
    if (!r.ok) return dbErr(res, r, 'Failed to load themes')
    const custom = await r.json()

    // Merge built-ins (always available) with workspace custom themes
    const builtins = Object.values(BUILTIN_THEMES).map((t) => ({ ...t, custom: false }))
    const customOut = custom.map((t) => ({ ...t, builtin: false, custom: true }))
    return ok(res, { themes: [...builtins, ...customOut] })
  }

  if (req.method === 'POST') {
    if (!(await enforceLimit(req, res, 'default'))) return
    const { name, is_default, config: themeConfig } = req.body || {}
    if (!name || typeof name !== 'string') return err(res, 'Missing name')
    if (!themeConfig || typeof themeConfig !== 'object') return err(res, 'Missing config')

    // If setting as default, clear any existing default for this workspace first
    if (is_default) {
      const clr = await sb(
        `workspace_carousel_themes?workspace_id=eq.${ws.id}&is_default=eq.true`,
        { method: 'PATCH', body: JSON.stringify({ is_default: false }) }
      )
      if (!clr.ok) return dbErr(res, clr, 'Failed to clear existing default')
    }

    const r = await sb('workspace_carousel_themes', {
      method: 'POST',
      body: JSON.stringify({
        workspace_id: ws.id,
        name: name.trim().slice(0, 80),
        is_default: !!is_default,
        config: themeConfig,
      }),
    })
    if (!r.ok) return dbErr(res, r, 'Failed to create theme')
    return ok(res, (await r.json())[0], 201)
  }

  return err(res, 'Method not allowed', 405)
}
