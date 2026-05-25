// GET    /api/content-item-comments?itemId=<uuid>     list comments oldest-first
// POST   /api/content-item-comments                    { itemId, body, kind } append
//
// Threaded comments on a content_item. Used during the approval workflow —
// "Request Changes" creates a comment with kind='change_request'; plain
// notes use kind='comment'. Comments are workspace-scoped (filtered at the
// API layer) and ordered ascending so the thread reads top-down.
//
// Identity (user_id / user_email) is derived from the verified Clerk JWT,
// never from the request body — the body contract intentionally omits both
// so an unauthenticated or impersonated caller cannot author a comment.
export const config = { runtime: 'nodejs' }

import { createClerkClient } from '@clerk/backend'
import { workspaceContext } from './_lib/workspaceContext.js'
import { requireRole } from './_lib/auth.js'
import { enforceLimit } from './_lib/ratelimit.js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY

let _clerk = null
function clerkClient() {
  if (!_clerk) _clerk = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY })
  return _clerk
}

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
  console.error(`[content-item-comments] ${msg} — supabase ${r.status}: ${body.slice(0, 300)}`)
  return res.status(500).json({ error: msg })
}

export default async function handler(req, res) {
  const ws = await workspaceContext(req)
  if (!ws) return err(res, 'Workspace not resolved', 400)

  const auth = await requireRole(req, null, { orgId: ws.clerk_org_id })
  if (!auth.ok) return res.status(auth.reason === 'forbidden' ? 403 : 401).json({ error: auth.reason })

  const wsFilter = `workspace_id=eq.${ws.id}`

  if (req.method === 'GET') {
    const { searchParams } = new URL(req.url, 'http://localhost')
    const itemId = searchParams.get('itemId')
    if (!itemId) return err(res, 'Missing itemId')

    const r = await sb(
      `content_item_comments?content_item_id=eq.${itemId}&${wsFilter}&select=id,user_id,user_email,body,kind,created_at&order=created_at.asc`
    )
    if (!r.ok) return dbErr(res, r)
    return ok(res, await r.json())
  }

  if (req.method === 'POST') {
    if (!(await enforceLimit(req, res, 'media'))) return
    const { itemId, body, kind } = req.body || {}
    if (!itemId) return err(res, 'Missing itemId')
    if (typeof body !== 'string' || !body.trim()) return err(res, 'Missing body')

    // Confirm the item belongs to this workspace.
    const chk = await sb(`content_items?id=eq.${itemId}&${wsFilter}&select=id`)
    if (!chk.ok) return dbErr(res, chk)
    const chkRows = await chk.json()
    if (!chkRows.length) return err(res, 'Content item not found', 404)

    // Resolve email from the verified Clerk user (cached by @clerk/backend).
    let userEmail = null
    try {
      const user = await clerkClient().users.getUser(auth.userId)
      userEmail = user?.primaryEmailAddress?.emailAddress || null
    } catch (e) {
      console.warn(`[content-item-comments] could not fetch Clerk user ${auth.userId}: ${e?.message}`)
    }

    const safeKind = kind === 'change_request' ? 'change_request' : 'comment'
    const ins = await sb('content_item_comments', {
      method: 'POST',
      body: JSON.stringify({
        workspace_id: ws.id,
        content_item_id: itemId,
        user_id: auth.userId,
        user_email: userEmail,
        body: body.trim(),
        kind: safeKind,
      }),
    })
    if (!ins.ok) return dbErr(res, ins, 'Insert failed')
    const rows = await ins.json()
    return ok(res, rows[0], 201)
  }

  return res.status(405).send('Method not allowed')
}
