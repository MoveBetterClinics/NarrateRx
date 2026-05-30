// CRUD for clinician recipes (named bundles of pre-interview levers).
// Each clinician can own multiple recipes; exactly one is `is_default=true`
// per clinician, enforced by partial unique index from migration 050.
//
// Routes:
//   GET    /api/db/staff-recipes?staffId=<uuid>   → list for clinician
//   POST   /api/db/staff-recipes                       → create
//   PATCH  /api/db/staff-recipes?id=<uuid>             → update
//   DELETE /api/db/staff-recipes?id=<uuid>             → delete
//
// All endpoints scope to the request's workspace via workspaceContext.

export const config = { runtime: 'nodejs' }

import { workspaceContext } from '../_lib/workspaceContext.js'
import { requireRole } from '../_lib/auth.js'
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

async function dbErr(res, r, msg = 'Database error', status = 500) {
  const body = await r.text().catch(() => '')
  console.error(`[db/staff-recipes] ${msg} — supabase ${r.status}: ${body.slice(0, 500)}`)
  return res.status(status).json({ error: msg })
}

const RECIPE_FIELDS = 'id,workspace_id,staff_id,name,emoji,is_default,audience,story_type,tone,voice_mode,cleanup_level,created_at,updated_at'

const PATCHABLE = new Set(['name', 'emoji', 'is_default', 'audience', 'story_type', 'tone', 'voice_mode', 'cleanup_level'])

// Clears is_default on all other recipes for the same clinician. Called
// before setting a new default (insert or update) so the partial unique
// index never collides. Workspace filter is mandatory — a missing filter
// would let a malformed call PATCH across workspaces (audit 2026-05-17).
async function clearOtherDefaults(workspaceId, staffId, exceptId = null) {
  const filter = exceptId
    ? `workspace_id=eq.${workspaceId}&staff_id=eq.${staffId}&id=neq.${exceptId}&is_default=eq.true`
    : `workspace_id=eq.${workspaceId}&staff_id=eq.${staffId}&is_default=eq.true`
  const r = await sb(`staff_recipes?${filter}`, {
    method: 'PATCH',
    body: JSON.stringify({ is_default: false }),
  })
  if (!r.ok) {
    const body = await r.text().catch(() => '')
    console.error(`[db/staff-recipes] clearOtherDefaults failed — supabase ${r.status}: ${body.slice(0, 500)}`)
  }
}

// Confirms a clinician id belongs to the current workspace before any
// operation accepts it as input. Prevents POSTing a staffId from
// another workspace and triggering cross-tenant mutations.
async function staffInWorkspace(workspaceId, staffId) {
  const r = await sb(`staff?id=eq.${staffId}&workspace_id=eq.${workspaceId}&select=id&limit=1`)
  if (!r.ok) return false
  const rows = await r.json().catch(() => [])
  return Array.isArray(rows) && rows.length > 0
}

export default async function handler(req, res) {
  const { searchParams } = new URL(req.url, 'http://localhost')
  const id = searchParams.get('id')
  const staffId = searchParams.get('staffId')

  const ws = await workspaceContext(req)
  if (!ws) return err(res, 'Workspace not resolved', 400)

  const auth = await requireRole(req, null, { orgId: ws.clerk_org_id })
  if (!auth.ok) {
    return res.status(auth.reason === 'forbidden' ? 403 : 401).json({ error: auth.reason })
  }
  const wsFilter = `workspace_id=eq.${ws.id}`

  if (req.method === 'GET') {
    if (!staffId) return err(res, 'Missing staffId')
    const r = await sb(`staff_recipes?${wsFilter}&staff_id=eq.${staffId}&select=${RECIPE_FIELDS}&order=is_default.desc,created_at.asc`)
    if (!r.ok) return dbErr(res, r)
    return ok(res, await r.json())
  }

  if (req.method === 'POST') {
    if (!(await enforceLimit(req, res, 'media'))) return
    const body = req.body || {}
    if (!body.staffId) return err(res, 'Missing staffId')
    if (!body.name?.trim())  return err(res, 'Name required')

    // Ownership check: the client-supplied staffId must belong to the
    // current workspace. Without this, a logged-in user from tenant A could
    // POST with a staffId from tenant B and clearOtherDefaults would
    // flip is_default across tenant B's rows.
    if (!(await staffInWorkspace(ws.id, body.staffId))) {
      return err(res, 'Clinician not found', 404)
    }

    const isDefault = !!body.is_default
    if (isDefault) await clearOtherDefaults(ws.id, body.staffId)

    const row = {
      workspace_id:  ws.id,
      staff_id:  body.staffId,
      name:          body.name.trim(),
      emoji:         body.emoji?.trim() || '⭐',
      is_default:    isDefault,
      audience:      body.audience      ?? null,
      story_type:    body.story_type    ?? null,
      tone:          body.tone          ?? null,
      voice_mode:    body.voice_mode    ?? null,
      cleanup_level: body.cleanup_level ?? null,
    }
    const r = await sb('staff_recipes', { method: 'POST', body: JSON.stringify(row) })
    if (!r.ok) return dbErr(res, r, 'Create failed')
    const data = await r.json()
    return ok(res, data[0], 201)
  }

  if (req.method === 'PATCH') {
    if (!(await enforceLimit(req, res, 'media'))) return
    if (!id) return err(res, 'Missing id')

    const body = req.body || {}
    const patch = { updated_at: new Date().toISOString() }
    for (const [k, v] of Object.entries(body)) {
      if (PATCHABLE.has(k)) patch[k] = v === '' ? null : v
    }
    if (Object.keys(patch).length <= 1) return err(res, 'No patchable fields')

    // If flipping to default, clear other defaults for this clinician first.
    if (patch.is_default === true) {
      // Need staff_id to clear siblings — fetch it.
      const lookup = await sb(`staff_recipes?id=eq.${id}&${wsFilter}&select=staff_id`)
      if (!lookup.ok) return dbErr(res, lookup)
      const rows = await lookup.json()
      if (!rows.length) return err(res, 'Not found', 404)
      await clearOtherDefaults(ws.id, rows[0].staff_id, id)
    }

    const r = await sb(`staff_recipes?id=eq.${id}&${wsFilter}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    })
    if (!r.ok) return dbErr(res, r, 'Update failed')
    const data = await r.json()
    return ok(res, data[0] ?? null)
  }

  if (req.method === 'DELETE') {
    if (!(await enforceLimit(req, res, 'media'))) return
    if (!id) return err(res, 'Missing id')
    const r = await sb(`staff_recipes?id=eq.${id}&${wsFilter}`, { method: 'DELETE' })
    if (!r.ok) return dbErr(res, r, 'Delete failed')
    return ok(res, { ok: true })
  }

  return res.status(405).send('Method not allowed')
}
