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

// Log a Supabase non-ok response body to function logs and return a generic
// 500 to the client. Public response stays opaque (no schema leak); details
// land in Vercel logs so the next "Database error" report is one log fetch
// away from a root cause.
async function dbErr(res, r, msg = 'Database error', status = 500) {
  const body = await r.text().catch(() => '')
  console.error(`[db/clinicians] ${msg} — supabase ${r.status}: ${body.slice(0, 500)}`)
  return res.status(status).json({ error: msg })
}

const CLINICIAN_RECIPE_FIELDS = 'default_audience,default_story_type,default_tone,default_voice_mode'
const CLINICIAN_BASE_FIELDS = `id,name,user_id,created_by_id,created_by_email,created_at,voice_notes,voice_notes_refreshed_at,voice_notes_edits_analyzed,${CLINICIAN_RECIPE_FIELDS}`
const INTERVIEW_FIELDS = 'id,topic,status,created_at,updated_at,owner_id,owner_email,verbatim_flags,messages,session_state,location_id,prototype_id,campaign_id,campaign:campaigns(id,name)'

// Slim shape for the Stories list. Drops the heavy `messages` and `session_state`
// JSON columns (full transcript per interview) which the list views never render —
// they are fetched separately by useStory() when a detail page opens.
// Includes a joined `campaign(id,name)` so the Stories card view can render the
// per-card campaign badge without a second hop.
const INTERVIEW_FIELDS_CARD = 'id,workspace_id,topic,status,session_state,created_at,updated_at,owner_id,owner_email,location_id,prototype_id,pull_quote_candidates,campaign_id,campaign:campaigns(id,name)'
const CLINICIAN_FIELDS_CARD = 'id,workspace_id,name,user_id,created_at'

export default async function handler(req, res) {
  const { searchParams } = new URL(req.url, 'http://localhost')
  const id = searchParams.get('id')
  const view = searchParams.get('view')   // 'card' = slim shape for Stories list
  const userId = req.headers['x-user-id'] ?? null

  const ws = await workspaceContext(req)
  if (!ws) return err(res, 'Workspace not resolved', 400)
  const wsFilter = `workspace_id=eq.${ws.id}`

  if (req.method === 'GET') {
    if (id) {
      // Single clinician with full interview list
      const r = await sb(`clinicians?id=eq.${id}&${wsFilter}&select=${CLINICIAN_BASE_FIELDS},interviews(${INTERVIEW_FIELDS})`)
      if (!r.ok) return dbErr(res, r)
      const data = await r.json()
      return ok(res, data[0] ?? null)
    }
    // All clinicians with interview summaries
    const clinicianSel = view === 'card' ? CLINICIAN_FIELDS_CARD : CLINICIAN_BASE_FIELDS
    const interviewSel = view === 'card' ? INTERVIEW_FIELDS_CARD : INTERVIEW_FIELDS
    const r = await sb(`clinicians?${wsFilter}&select=${clinicianSel},interviews(${interviewSel})&order=name.asc`)
    if (!r.ok) return dbErr(res, r)
    return ok(res, await r.json())
  }

  if (req.method === 'POST') {
    if (!(await enforceLimit(req, res, 'media'))) return

    const { name, createdById, createdByEmail, userId: bindUserId } = req.body || {}
    if (!name?.trim()) return err(res, 'Name required')
    if (!createdById) return err(res, 'Unauthorized', 401)

    const selectExpr = `${CLINICIAN_BASE_FIELDS},interviews(${INTERVIEW_FIELDS})`

    // Identity resolution — `user_id` wins when the caller flagged this as a
    // Self interview (typed name matches the user's display/full name).
    // The row's `name` field is treated as a free-floating label: if the
    // user is starting an interview as "Dr. Q" but the existing row says
    // "Dr. Michael Quasney", we update the label to match what they're
    // using right now. Phase 4 default_* columns predate the recipes
    // table and are untouched here.
    if (bindUserId) {
      const byUserRes = await sb(`clinicians?${wsFilter}&user_id=eq.${encodeURIComponent(bindUserId)}&select=${selectExpr}`)
      if (!byUserRes.ok) return dbErr(res, byUserRes)
      const byUser = await byUserRes.json()
      if (byUser.length > 0) {
        const existing = byUser[0]
        if (existing.name !== name.trim()) {
          // Label drifted — sync it. Don't return until the update lands,
          // otherwise the caller sees the old name and the UI flickers.
          const patchRes = await sb(`clinicians?id=eq.${existing.id}&${wsFilter}`, {
            method: 'PATCH',
            body: JSON.stringify({ name: name.trim(), updated_at: new Date().toISOString() }),
          })
          if (patchRes.ok) {
            const patched = await patchRes.json()
            return ok(res, { ...existing, ...patched[0] })
          }
          // Patch failed but we still have the row — return it with the
          // typed name so the caller's flow continues. Logged for visibility.
          console.warn(`[db/clinicians] name sync failed for ${existing.id}; returning unsynced row`)
        }
        return ok(res, existing)
      }
    }

    // Fallback / proxy path: find existing by name (case-insensitive) within
    // this workspace. Used when the caller didn't bind to a user_id
    // (admin recording an interview with a guest), or when the user is
    // self-interviewing but happens to have no user_id-bound row yet.
    const findRes = await sb(`clinicians?${wsFilter}&name=ilike.${encodeURIComponent(name.trim())}&select=${selectExpr}`)
    if (!findRes.ok) return dbErr(res, findRes)
    const found = await findRes.json()
    if (found.length > 0) {
      const existing = found[0]
      // If the caller bound a user_id and the matched row doesn't have one
      // yet, claim it — upgrades a proxy row into a Self row on first match.
      if (bindUserId && !existing.user_id) {
        const claim = await sb(`clinicians?id=eq.${existing.id}&${wsFilter}`, {
          method: 'PATCH',
          body: JSON.stringify({ user_id: bindUserId, updated_at: new Date().toISOString() }),
        })
        if (claim.ok) {
          const claimed = await claim.json()
          return ok(res, { ...existing, ...claimed[0] })
        }
      }
      return ok(res, existing)
    }

    // Create new
    const createRes = await sb('clinicians', {
      method: 'POST',
      body: JSON.stringify({
        workspace_id: ws.id,
        name: name.trim(),
        user_id: bindUserId || null,
        created_by_id: createdById,
        created_by_email: createdByEmail,
      }),
    })
    if (!createRes.ok) return dbErr(res, createRes, 'Create failed')
    const data = await createRes.json()
    return ok(res, data[0], 201)
  }

  if (req.method === 'PATCH') {
    if (!(await enforceLimit(req, res, 'media'))) return

    if (!id) return err(res, 'Missing id')
    if (!userId) return err(res, 'Unauthorized', 401)

    const PATCHABLE = new Set(['default_audience', 'default_story_type', 'default_tone', 'default_voice_mode', 'voice_notes'])
    const body = req.body || {}
    const patch = { updated_at: new Date().toISOString() }
    for (const [k, v] of Object.entries(body)) {
      if (PATCHABLE.has(k)) patch[k] = v === '' ? null : v
    }
    if (Object.keys(patch).length <= 1) return err(res, 'No patchable fields')

    const r = await sb(`clinicians?id=eq.${id}&${wsFilter}`, {
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
    if (!userId) return err(res, 'Unauthorized', 401)

    const chk = await sb(`clinicians?id=eq.${id}&${wsFilter}&select=created_by_id`)
    if (!chk.ok) return dbErr(res, chk)
    const rows = await chk.json()
    if (!rows.length) return err(res, 'Not found', 404)
    if (rows[0].created_by_id !== userId) return err(res, 'Forbidden', 403)

    const r = await sb(`clinicians?id=eq.${id}&${wsFilter}`, { method: 'DELETE' })
    if (!r.ok) return dbErr(res, r, 'Delete failed')
    return ok(res, { ok: true })
  }

  return res.status(405).send('Method not allowed')
}
