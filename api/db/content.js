// Pinned to Node runtime so the Edge whole-graph bundler doesn't follow
// the ratelimit.js → @clerk/backend → node:crypto chain into middleware.
// Uses Express-style (req, res) handler — the Web-style (req) → Response
// pattern silently hangs on Vercel's Node runtime (response never sent;
// function times out at 300s). Match the convention used by /api/content-pieces/*.
export const config = { runtime: 'nodejs' }

import { workspaceContext } from '../_lib/workspaceContext.js'
import { enforceLimit } from '../_lib/ratelimit.js'

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

const SELECT = 'id,interview_id,clinician_id,clinician_name,topic,platform,content,status,scheduled_at,published_at,media_urls,platform_post_id,buffer_update_id,resolved_url,target_locations,location_id,notes,reviewed_by,approved_by,performed_well,created_at,updated_at'

export default async function handler(req, res) {
  const { searchParams } = new URL(req.url, 'http://localhost')
  const id = searchParams.get('id')

  const ws = await workspaceContext(req)
  if (!ws) return err(res, 'Workspace not resolved', 400)
  const wsFilter = `workspace_id=eq.${ws.id}`

  // ── GET ──────────────────────────────────────────────────────────────────
  if (req.method === 'GET') {
    if (id) {
      const r = await sb(`content_items?id=eq.${id}&${wsFilter}&select=${SELECT}`)
      if (!r.ok) return err(res, 'Database error', 500)
      const data = await r.json()
      return ok(res, data[0] ?? null)
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

    const r = await sb(qs)
    if (!r.ok) return err(res, 'Database error', 500)
    return ok(res, await r.json())
  }

  // ── POST (bulk create from interview outputs) ────────────────────────────
  if (req.method === 'POST') {
    if (!(await enforceLimit(req, res, 'media'))) return

    const body = req.body

    // Bulk insert
    if (Array.isArray(body)) {
      const rows = body.map((r) => ({ ...r, workspace_id: ws.id }))
      const r = await sb('content_items', {
        method: 'POST',
        body: JSON.stringify(rows),
      })
      if (!r.ok) return err(res, 'Insert failed', 500)
      return ok(res, await r.json(), 201)
    }

    // Single insert
    const { interviewId, clinicianId, clinicianName, topic, platform, content, status } = body || {}
    if (!interviewId || !platform || !content) return err(res, 'Missing required fields')

    const row = { workspace_id: ws.id, interview_id: interviewId, clinician_id: clinicianId, clinician_name: clinicianName, topic, platform, content }
    if (status) row.status = status
    const r = await sb('content_items', {
      method: 'POST',
      body: JSON.stringify(row),
    })
    if (!r.ok) return err(res, 'Insert failed', 500)
    const data = await r.json()
    return ok(res, data[0], 201)
  }

  // ── PATCH ────────────────────────────────────────────────────────────────
  if (req.method === 'PATCH') {
    if (!(await enforceLimit(req, res, 'media'))) return

    if (!id) return err(res, 'Missing id')
    const patch = req.body || {}

    // Map camelCase → snake_case
    const allowed = {
      content:         patch.content,
      status:          patch.status,
      scheduled_at:    patch.scheduledAt,
      published_at:    patch.publishedAt,
      media_urls:      patch.mediaUrls,
      platform_post_id: patch.platformPostId,
      buffer_update_id: patch.bufferUpdateId,
      resolved_url:    patch.resolvedUrl,
      target_locations: patch.targetLocations,
      location_id:     patch.locationId,
      reviewed_by:     patch.reviewedBy,
      approved_by:     patch.approvedBy,
      performed_well:  patch.performedWell,
      notes:           patch.notes,
      updated_at:      patch.updatedAt,
    }
    const body = Object.fromEntries(Object.entries(allowed).filter(([, v]) => v !== undefined))

    const r = await sb(`content_items?id=eq.${id}&${wsFilter}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    })
    if (!r.ok) return err(res, 'Update failed', 500)
    const data = await r.json()
    return ok(res, data[0])
  }

  // ── DELETE ───────────────────────────────────────────────────────────────
  if (req.method === 'DELETE') {
    if (!(await enforceLimit(req, res, 'media'))) return

    if (!id) return err(res, 'Missing id')
    const r = await sb(`content_items?id=eq.${id}&${wsFilter}`, { method: 'DELETE' })
    if (!r.ok) return err(res, 'Delete failed', 500)
    return ok(res, { deleted: true })
  }

  return err(res, 'Method not allowed', 405)
}
