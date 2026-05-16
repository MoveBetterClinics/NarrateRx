// Node runtime — follows the same conventions as api/db/content.js.
// Uses Express-style (req, res) handler; never returns new Response().
export const config = { runtime: 'nodejs' }

import { workspaceContext } from '../_lib/workspaceContext.js'
import { requireRole } from '../_lib/auth.js'

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

async function dbErr(res, r, msg = 'Database error', status = 500) {
  const body = await r.text().catch(() => '')
  console.error(`[db/comments] ${msg} — supabase ${r.status}: ${body.slice(0, 500)}`)
  return res.status(status).json({ error: msg })
}

const SELECT = 'id,workspace_id,content_item_id,user_id,user_email,body,kind,created_at'

export default async function handler(req, res) {
  const { searchParams } = new URL(req.url, 'http://localhost')

  const ws = await workspaceContext(req)
  if (!ws) return err(res, 'Unauthorized', 401)
  const wsFilter = `workspace_id=eq.${ws.id}`

  // Auth — any signed-in user may read/write; only admin can delete others'
  const auth = await requireRole(req, null, { orgId: ws.clerk_org_id })
  if (!auth.ok) return err(res, 'Unauthorized', 401)
  const { userId, role } = auth

  // Derive user_email from Clerk — auth.user.id only; fetch email from req header
  // The Clerk JWT doesn't include email by default, so we read it from the
  // x-clerk-user-email header that the frontend sends, or fall back to the userId.
  const userEmail =
    req.headers['x-clerk-user-email'] ||
    req.headers['x-user-email'] ||
    userId

  // ── GET — list comments for a content item ─────────────────────────────────
  if (req.method === 'GET') {
    const contentItemId = searchParams.get('contentItemId')
    if (!contentItemId) return err(res, 'Missing contentItemId')

    const qs = `content_item_comments?${wsFilter}&content_item_id=eq.${contentItemId}&select=${SELECT}&order=created_at.asc`
    const r = await sb(qs)
    if (!r.ok) return dbErr(res, r)
    return ok(res, await r.json())
  }

  // ── POST — create a comment ────────────────────────────────────────────────
  if (req.method === 'POST') {
    const { contentItemId, body: body_, kind = 'comment' } = req.body || {}
    if (!contentItemId) return err(res, 'Missing contentItemId')
    if (!body_ || !body_.trim()) return err(res, 'Missing body')
    if (!['comment', 'change_request'].includes(kind)) return err(res, 'Invalid kind')

    const row = {
      workspace_id: ws.id,
      content_item_id: contentItemId,
      user_id: userId,
      user_email: userEmail,
      body: body_.trim(),
      kind,
    }

    const r = await sb('content_item_comments', {
      method: 'POST',
      body: JSON.stringify(row),
    })
    if (!r.ok) return dbErr(res, r, 'Insert failed')
    const data = await r.json()
    return ok(res, data[0], 201)
  }

  // ── DELETE — remove a comment (own or admin) ───────────────────────────────
  if (req.method === 'DELETE') {
    const id = searchParams.get('id')
    if (!id) return err(res, 'Missing id')

    // Fetch the comment first to check ownership
    const checkR = await sb(`content_item_comments?id=eq.${id}&${wsFilter}&select=id,user_id`)
    if (!checkR.ok) return dbErr(res, checkR)
    const rows = await checkR.json()
    if (!rows.length) return err(res, 'Not found', 404)

    const comment = rows[0]
    if (comment.user_id !== userId && role !== 'admin') {
      return err(res, 'Forbidden', 403)
    }

    const r = await sb(`content_item_comments?id=eq.${id}&${wsFilter}`, { method: 'DELETE' })
    if (!r.ok) return dbErr(res, r, 'Delete failed')
    return ok(res, { deleted: true })
  }

  return err(res, 'Method not allowed', 405)
}
