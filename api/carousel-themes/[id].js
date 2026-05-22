// PATCH  /api/carousel-themes/:id  — update name, is_default, or config
// DELETE /api/carousel-themes/:id  — delete (refuses if stories still use it)
export const config = { runtime: 'nodejs' }

import { workspaceContext } from '../_lib/workspaceContext.js'

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
  console.error(`[carousel-themes/[id]] ${msg} — supabase ${r.status}: ${body.slice(0, 300)}`)
  return res.status(500).json({ error: msg })
}

export default async function handler(req, res) {
  const ws = await workspaceContext(req)
  if (!ws) return err(res, 'Workspace not resolved', 400)

  const { searchParams } = new URL(req.url, 'http://localhost')
  const id = searchParams.get('id')
  if (!id) return err(res, 'Missing id')

  // Confirm the theme belongs to this workspace
  const chk = await sb(
    `workspace_carousel_themes?id=eq.${id}&workspace_id=eq.${ws.id}&select=id`
  )
  if (!chk.ok) return dbErr(res, chk)
  if (!(await chk.json()).length) return err(res, 'Theme not found', 404)

  if (req.method === 'PATCH') {
    const { name, is_default, config: themeConfig } = req.body || {}
    const patch = {}
    if (name !== undefined)        patch.name       = String(name).trim().slice(0, 80)
    if (themeConfig !== undefined) patch.config     = themeConfig
    if (is_default !== undefined)  patch.is_default = !!is_default
    if (!Object.keys(patch).length) return err(res, 'No fields to update')

    patch.updated_at = new Date().toISOString()

    // If setting as default, clear any existing default first (excluding this row)
    if (patch.is_default) {
      const clr = await sb(
        `workspace_carousel_themes?workspace_id=eq.${ws.id}&is_default=eq.true&id=neq.${id}`,
        { method: 'PATCH', body: JSON.stringify({ is_default: false }) }
      )
      if (!clr.ok) return dbErr(res, clr, 'Failed to clear existing default')
    }

    const r = await sb(
      `workspace_carousel_themes?id=eq.${id}&workspace_id=eq.${ws.id}`,
      { method: 'PATCH', body: JSON.stringify(patch) }
    )
    if (!r.ok) return dbErr(res, r, 'Failed to update theme')
    return ok(res, (await r.json())[0])
  }

  if (req.method === 'DELETE') {
    // Check if any stories are still referencing this theme
    const inUse = await sb(
      `content_items?workspace_id=eq.${ws.id}&carousel_theme_id=eq.${id}&select=id`
    )
    if (!inUse.ok) return dbErr(res, inUse)
    const rows = await inUse.json()
    if (rows.length > 0) {
      return err(res, `Theme is used by ${rows.length} story(s). Reassign them first.`, 409)
    }

    const r = await sb(
      `workspace_carousel_themes?id=eq.${id}&workspace_id=eq.${ws.id}`,
      { method: 'DELETE', headers: { Prefer: 'return=minimal' } }
    )
    if (!r.ok) return dbErr(res, r, 'Failed to delete theme')
    return res.status(204).end()
  }

  return err(res, 'Method not allowed', 405)
}
