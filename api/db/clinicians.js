// Pinned to Node runtime so the Edge whole-graph bundler doesn't follow
// the ratelimit.js → @clerk/backend → node:crypto chain into middleware.
// Web-style (Request → Response) handler still works on Vercel's Node/Fluid runtime.
export const config = { runtime: 'nodejs' }

import { workspaceContext } from '../_lib/workspaceContext.js'
import { enforceLimitEdge } from '../_lib/ratelimit.js'

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

const ok = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })
const err = (msg, status = 400) =>
  new Response(JSON.stringify({ error: msg }), { status, headers: { 'Content-Type': 'application/json' } })

const INTERVIEW_FIELDS = 'id,topic,status,created_at,updated_at,owner_id,owner_email'

export default async function handler(req) {
  const { searchParams } = new URL(req.url, 'http://localhost')
  const id = searchParams.get('id')
  const userId = req.headers.get('x-user-id')

  const ws = await workspaceContext(req)
  if (!ws) return err('Workspace not resolved', 400)
  const wsFilter = `workspace_id=eq.${ws.id}`

  if (req.method === 'GET') {
    if (id) {
      // Single clinician with full interview list
      const res = await sb(`clinicians?id=eq.${id}&${wsFilter}&select=id,name,created_by_id,created_by_email,created_at,interviews(${INTERVIEW_FIELDS})`)
      if (!res.ok) return err('Database error', 500)
      const data = await res.json()
      return ok(data[0] ?? null)
    }
    // All clinicians with interview summaries
    const res = await sb(`clinicians?${wsFilter}&select=id,name,created_by_id,created_by_email,created_at,interviews(${INTERVIEW_FIELDS})&order=name.asc`)
    if (!res.ok) return err('Database error', 500)
    return ok(await res.json())
  }

  if (req.method === 'POST') {
    const limited = await enforceLimitEdge(req, 'media')
    if (limited) return limited

    const { name, createdById, createdByEmail } = await req.json()
    if (!name?.trim()) return err('Name required')
    if (!createdById) return err('Unauthorized', 401)

    // Find existing by name (case-insensitive) within this workspace
    const findRes = await sb(`clinicians?${wsFilter}&name=ilike.${encodeURIComponent(name.trim())}&select=id,name,created_by_id,created_by_email,created_at,interviews(${INTERVIEW_FIELDS})`)
    if (!findRes.ok) return err('Database error', 500)
    const found = await findRes.json()
    if (found.length > 0) return ok(found[0])

    // Create new
    const createRes = await sb('clinicians', {
      method: 'POST',
      body: JSON.stringify({
        workspace_id: ws.id,
        name: name.trim(),
        created_by_id: createdById,
        created_by_email: createdByEmail,
      }),
    })
    if (!createRes.ok) return err('Create failed', 500)
    const data = await createRes.json()
    return ok(data[0], 201)
  }

  if (req.method === 'DELETE') {
    const limited = await enforceLimitEdge(req, 'media')
    if (limited) return limited

    if (!id) return err('Missing id')
    if (!userId) return err('Unauthorized', 401)

    const chk = await sb(`clinicians?id=eq.${id}&${wsFilter}&select=created_by_id`)
    if (!chk.ok) return err('Database error', 500)
    const rows = await chk.json()
    if (!rows.length) return err('Not found', 404)
    if (rows[0].created_by_id !== userId) return err('Forbidden', 403)

    const res = await sb(`clinicians?id=eq.${id}&${wsFilter}`, { method: 'DELETE' })
    if (!res.ok) return err('Delete failed', 500)
    return ok({ ok: true })
  }

  return new Response('Method not allowed', { status: 405 })
}
