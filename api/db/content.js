export const config = { runtime: 'edge' }

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

const ok  = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })
const err = (msg, status = 400)  => new Response(JSON.stringify({ error: msg }), { status, headers: { 'Content-Type': 'application/json' } })

const SELECT = 'id,interview_id,clinician_id,clinician_name,topic,platform,content,status,scheduled_at,published_at,media_urls,platform_post_id,buffer_update_id,target_locations,location_id,notes,reviewed_by,approved_by,created_at,updated_at'

export default async function handler(req) {
  const { searchParams } = new URL(req.url)
  const id = searchParams.get('id')

  const ws = await workspaceContext(req)
  if (!ws) return err('Workspace not resolved', 400)
  const wsFilter = `workspace_id=eq.${ws.id}`

  // ── GET ──────────────────────────────────────────────────────────────────
  if (req.method === 'GET') {
    if (id) {
      const res = await sb(`content_items?id=eq.${id}&${wsFilter}&select=${SELECT}`)
      if (!res.ok) return err('Database error', 500)
      const data = await res.json()
      return ok(data[0] ?? null)
    }

    // List with optional filters
    const status      = searchParams.get('status')
    const platform    = searchParams.get('platform')
    const from        = searchParams.get('from')        // ISO date
    const to          = searchParams.get('to')          // ISO date
    const interviewId = searchParams.get('interviewId')
    const limit       = parseInt(searchParams.get('limit') || '100')

    let qs = `content_items?${wsFilter}&select=${SELECT}&order=created_at.desc&limit=${limit}`
    if (status)      qs += `&status=eq.${status}`
    if (platform)    qs += `&platform=eq.${platform}`
    if (from)        qs += `&scheduled_at=gte.${from}`
    if (to)          qs += `&scheduled_at=lte.${to}`
    if (interviewId) qs += `&interview_id=eq.${interviewId}`

    const res = await sb(qs)
    if (!res.ok) return err('Database error', 500)
    return ok(await res.json())
  }

  // ── POST (bulk create from interview outputs) ────────────────────────────
  if (req.method === 'POST') {
    const body = await req.json()

    // Bulk insert
    if (Array.isArray(body)) {
      const rows = body.map((r) => ({ ...r, workspace_id: ws.id }))
      const res = await sb('content_items', {
        method: 'POST',
        body: JSON.stringify(rows),
      })
      if (!res.ok) return err('Insert failed', 500)
      return ok(await res.json(), 201)
    }

    // Single insert
    const { interviewId, clinicianId, clinicianName, topic, platform, content, status } = body
    if (!interviewId || !platform || !content) return err('Missing required fields')

    const row = { workspace_id: ws.id, interview_id: interviewId, clinician_id: clinicianId, clinician_name: clinicianName, topic, platform, content }
    if (status) row.status = status
    const res = await sb('content_items', {
      method: 'POST',
      body: JSON.stringify(row),
    })
    if (!res.ok) return err('Insert failed', 500)
    const data = await res.json()
    return ok(data[0], 201)
  }

  // ── PATCH ────────────────────────────────────────────────────────────────
  if (req.method === 'PATCH') {
    if (!id) return err('Missing id')
    const patch = await req.json()

    // Map camelCase → snake_case
    const allowed = {
      content:         patch.content,
      status:          patch.status,
      scheduled_at:    patch.scheduledAt,
      published_at:    patch.publishedAt,
      media_urls:      patch.mediaUrls,
      platform_post_id: patch.platformPostId,
      buffer_update_id: patch.bufferUpdateId,
      target_locations: patch.targetLocations,
      location_id:     patch.locationId,
      reviewed_by:     patch.reviewedBy,
      approved_by:     patch.approvedBy,
      notes:           patch.notes,
      updated_at:      patch.updatedAt,
    }
    const body = Object.fromEntries(Object.entries(allowed).filter(([, v]) => v !== undefined))

    const res = await sb(`content_items?id=eq.${id}&${wsFilter}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    })
    if (!res.ok) return err('Update failed', 500)
    const data = await res.json()
    return ok(data[0])
  }

  // ── DELETE ───────────────────────────────────────────────────────────────
  if (req.method === 'DELETE') {
    if (!id) return err('Missing id')
    const res = await sb(`content_items?id=eq.${id}&${wsFilter}`, { method: 'DELETE' })
    if (!res.ok) return err('Delete failed', 500)
    return ok({ deleted: true })
  }

  return err('Method not allowed', 405)
}
