// GET    /api/content-item-drafts?itemId=<uuid>      list recent drafts (latest first, cap 5)
// POST   /api/content-item-drafts                     { itemId, body, aiGenerated } create draft snapshot
//
// Append-only draft history for a content_item. Old entries beyond the
// 5 most recent are trimmed in the POST path so the table doesn't grow
// unbounded. Workspace isolation is enforced at the API layer — every
// query filters by workspace_id resolved from the request host.
export const config = { runtime: 'nodejs' }

import { workspaceContext } from './_lib/workspaceContext.js'
import { requireRole } from './_lib/auth.js'
import { EDITOR_ROLES } from './_lib/roles.js'
import { enforceLimit } from './_lib/ratelimit.js'

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
  console.error(`[content-item-drafts] ${msg} — supabase ${r.status}: ${body.slice(0, 300)}`)
  return res.status(500).json({ error: msg })
}

const DRAFT_CAP = 5

export default async function handler(req, res) {
  const ws = await workspaceContext(req)
  if (!ws) return err(res, 'Workspace not resolved', 400)
  const wsFilter = `workspace_id=eq.${ws.id}`

  const allowedRoles = req.method === 'GET' ? null : EDITOR_ROLES
  const auth = await requireRole(req, allowedRoles, { orgId: ws.clerk_org_id })
  if (!auth.ok) {
    return res.status(auth.reason === 'forbidden' ? 403 : 401).json({ error: auth.reason })
  }

  if (req.method === 'GET') {
    const { searchParams } = new URL(req.url, 'http://localhost')
    const itemId = searchParams.get('itemId')
    if (!itemId) return err(res, 'Missing itemId')

    const r = await sb(
      `content_item_drafts?content_item_id=eq.${itemId}&${wsFilter}&select=id,body,ai_generated,created_at&order=created_at.desc&limit=${DRAFT_CAP}`
    )
    if (!r.ok) return dbErr(res, r)
    return ok(res, await r.json())
  }

  if (req.method === 'POST') {
    if (!(await enforceLimit(req, res, 'media'))) return
    const { itemId, body, aiGenerated } = req.body || {}
    if (!itemId) return err(res, 'Missing itemId')
    if (typeof body !== 'string') return err(res, 'Missing body')

    // Defense-in-depth: confirm the content_item belongs to this workspace
    // before snapshotting. Otherwise a leaked itemId could be used to
    // back-fill drafts attributed to a workspace that doesn't own it.
    const chk = await sb(`content_items?id=eq.${itemId}&${wsFilter}&select=id`)
    if (!chk.ok) return dbErr(res, chk)
    const chkRows = await chk.json()
    if (!chkRows.length) return err(res, 'Content item not found', 404)

    const ins = await sb('content_item_drafts', {
      method: 'POST',
      body: JSON.stringify({
        workspace_id: ws.id,
        content_item_id: itemId,
        body,
        ai_generated: !!aiGenerated,
      }),
    })
    if (!ins.ok) return dbErr(res, ins, 'Insert failed')
    const rows = await ins.json()

    // Trim to the latest DRAFT_CAP per content item. PostgREST doesn't
    // support a windowed delete in one call, so fetch ids beyond the cap
    // and delete them in a second hit. Failure here is non-fatal — the
    // user already got their new snapshot.
    try {
      const idRes = await sb(
        `content_item_drafts?content_item_id=eq.${itemId}&${wsFilter}&select=id&order=created_at.desc&offset=${DRAFT_CAP}`
      )
      if (idRes.ok) {
        const stale = await idRes.json()
        if (stale.length > 0) {
          const ids = stale.map((r) => r.id).join(',')
          await sb(`content_item_drafts?id=in.(${ids})&${wsFilter}`, { method: 'DELETE' })
        }
      }
    } catch { /* non-fatal */ }

    return ok(res, rows[0], 201)
  }

  return res.status(405).send('Method not allowed')
}
