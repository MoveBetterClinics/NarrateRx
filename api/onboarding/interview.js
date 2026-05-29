// Onboarding interview persistence — the one-time interview the founder runs
// after the signup wizard creates the workspace. P3 adds the synthesis call;
// P4 adds the Home card. See src/lib/prompts.js#getOnboardingInterviewSystemPrompt
// for the script.
//
// Pinned to Node runtime — matches the convention used by api/db/interviews.js
// and avoids the Edge whole-graph bundler dragging Clerk → node:crypto through.
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
  console.error(`[onboarding/interview] ${msg} — supabase ${r.status}: ${body.slice(0, 500)}`)
  return res.status(status).json({ error: msg })
}

const SELECT_COLS = 'id,workspace_id,staff_id,owner_id,messages,session_state,status,synthesis_result,completed_at,synthesized_at,created_at,updated_at'

// Look up the founder's Self-clinician row by Clerk user_id; create one if
// missing. Returns { staffId } or { error, status } on failure.
async function findOrCreateFounderClinician(ws, userId, fallbackName) {
  const lookup = await sb(
    `staff?workspace_id=eq.${ws.id}&user_id=eq.${encodeURIComponent(userId)}&select=id&limit=1`
  )
  if (!lookup.ok) {
    const body = await lookup.text().catch(() => '')
    console.error(`[onboarding/interview] clinician lookup failed: ${lookup.status}: ${body.slice(0, 300)}`)
    return { error: 'Founder lookup failed', status: 500 }
  }
  const rows = await lookup.json()
  if (rows[0]?.id) return { staffId: rows[0].id }

  // No clinician row yet. Create a Self-clinician keyed to this Clerk user.
  const name = (fallbackName || '').trim() || 'Founder'
  const create = await sb('staff', {
    method: 'POST',
    body: JSON.stringify({
      workspace_id: ws.id,
      user_id: userId,
      name,
    }),
  })
  if (!create.ok) {
    const body = await create.text().catch(() => '')
    console.error(`[onboarding/interview] clinician create failed: ${create.status}: ${body.slice(0, 300)}`)
    return { error: 'Founder create failed', status: 500 }
  }
  const created = await create.json()
  return { staffId: created[0]?.id }
}

export default async function handler(req, res) {
  const ws = await workspaceContext(req)
  if (!ws) return err(res, 'Workspace not resolved', 400)

  // Onboarding interview is founder-only — gate on workspace admin role.
  // (Org admin or 'internal' plan member, per requireRole's role resolution.)
  const auth = await requireRole(req, ['admin'], { orgId: ws.clerk_org_id })
  if (!auth.ok) return err(res, auth.reason, auth.reason === 'forbidden' ? 403 : 401)

  const { searchParams } = new URL(req.url, 'http://localhost')
  const id = searchParams.get('id')

  if (req.method === 'GET') {
    if (id) {
      const r = await sb(
        `workspace_onboarding_interviews?id=eq.${id}&workspace_id=eq.${ws.id}&select=${SELECT_COLS}`
      )
      if (!r.ok) return dbErr(res, r)
      const data = await r.json()
      return ok(res, data[0] ?? null)
    }
    // No id — return the workspace's current non-abandoned onboarding interview
    // (the most recently created if multiple, though there should normally be one).
    const r = await sb(
      `workspace_onboarding_interviews?workspace_id=eq.${ws.id}&status=neq.abandoned&select=${SELECT_COLS}&order=created_at.desc&limit=1`
    )
    if (!r.ok) return dbErr(res, r)
    const data = await r.json()
    return ok(res, data[0] ?? null)
  }

  if (req.method === 'POST') {
    if (!(await enforceLimit(req, res, 'media'))) return

    const { founderName } = req.body || {}
    const found = await findOrCreateFounderClinician(ws, auth.userId, founderName)
    if (found.error) return err(res, found.error, found.status || 500)

    const r = await sb('workspace_onboarding_interviews', {
      method: 'POST',
      body: JSON.stringify({
        workspace_id: ws.id,
        staff_id: found.staffId || null,
        owner_id: auth.userId,
        messages: [],
        status: 'in_progress',
      }),
    })
    if (!r.ok) return dbErr(res, r, 'Create failed')
    const data = await r.json()
    return ok(res, data[0] ?? null, 201)
  }

  if (req.method === 'PATCH') {
    if (!id) return err(res, 'Missing id')

    const { messages, sessionState, status, completedAt } = req.body || {}

    // Ownership: only the founder who started the interview can modify it.
    // workspace_id filter is the multi-tenant fence; owner_id is the per-row check.
    const existing = await sb(
      `workspace_onboarding_interviews?id=eq.${id}&workspace_id=eq.${ws.id}&select=owner_id,status`
    )
    if (!existing.ok) return dbErr(res, existing)
    const row = (await existing.json())[0]
    if (!row) return err(res, 'Not found', 404)
    if (row.owner_id !== auth.userId) return err(res, 'Forbidden', 403)
    if (row.status === 'synthesized' || row.status === 'abandoned') {
      return err(res, `Cannot modify ${row.status} interview`, 409)
    }

    const patch = { updated_at: new Date().toISOString() }
    if (Array.isArray(messages))     patch.messages = messages
    if (sessionState !== undefined)  patch.session_state = sessionState
    if (status)                      patch.status = status
    if (completedAt)                 patch.completed_at = completedAt

    const r = await sb(
      `workspace_onboarding_interviews?id=eq.${id}&workspace_id=eq.${ws.id}`,
      { method: 'PATCH', body: JSON.stringify(patch) }
    )
    if (!r.ok) return dbErr(res, r, 'Update failed')
    const data = await r.json()
    return ok(res, data[0] ?? null)
  }

  return err(res, 'Method not allowed', 405)
}
