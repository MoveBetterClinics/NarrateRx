// PATCH /api/content-plan/channel?interview_id=X   { platform, enabled }
//
// Per-story channel control. Enables or disables one Content Plan channel (an
// ATOM_DEFINITIONS platform key) for a single interview:
//
//   - enabled:false  → "remove this channel from this plan". Skips every
//     non-published atom for the platform (restorable; published posts are
//     never hidden) and drops the channel from interviews.selected_outputs.
//   - enabled:true   → "add this channel back". Restores skipped atoms to their
//     prior state (drafted if a content piece exists, else pending) and re-adds
//     the channel to interviews.selected_outputs.
//
// interviews.selected_outputs is the per-story override of workspaces.enabled_
// outputs (registry-id namespace). null = inherit the workspace default. Once a
// channel is toggled here, the array is materialized so any future plan
// (re)seed via buildPlanRows honors the per-story choice.
export const config = { runtime: 'nodejs' }

import { workspaceContext } from '../_lib/workspaceContext.js'
import { requireRole } from '../_lib/auth.js'
import { EDITOR_ROLES } from '../_lib/roles.js'
import { enforceLimit } from '../_lib/ratelimit.js'
import { ATOM_DEFINITIONS, channelIdsForAtomPlatform } from '../_lib/atomPlan.js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY

function sb(path, init = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey:        SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      Prefer:        'return=representation',
      ...init.headers,
    },
  })
}

const ok  = (res, data, status = 200) => res.status(status).json(data)
const err = (res, msg, status = 400)  => res.status(status).json({ error: msg })

export default async function handler(req, res) {
  if (req.method !== 'PATCH') return err(res, 'Method not allowed', 405)

  const { searchParams } = new URL(req.url, 'http://localhost')

  const ws = await workspaceContext(req)
  if (!ws) return err(res, 'Workspace not resolved', 400)
  const wsFilter = `workspace_id=eq.${ws.id}`

  const auth = await requireRole(req, EDITOR_ROLES, { orgId: ws.clerk_org_id })
  if (!auth.ok) {
    return res.status(auth.reason === 'forbidden' ? 403 : 401).json({ error: auth.reason })
  }

  if (!(await enforceLimit(req, res, 'write'))) return

  const interviewId = searchParams.get('interview_id')
  if (!interviewId) return err(res, 'Missing interview_id')

  const { platform, enabled } = req.body || {}
  if (!platform || !ATOM_DEFINITIONS[platform]) return err(res, 'Invalid platform')
  if (typeof enabled !== 'boolean') return err(res, 'Missing enabled flag')

  // Verify the interview belongs to this workspace and read its current
  // per-story channel selection (null = inherit workspaces.enabled_outputs).
  const ivRes = await sb(`interviews?id=eq.${interviewId}&${wsFilter}&select=selected_outputs`)
  if (!ivRes.ok) return err(res, 'Database error', 500)
  const ivRows = await ivRes.json()
  if (!ivRows.length) return err(res, 'Interview not found', 404)

  // ── Update interviews.selected_outputs (the regen guard) ───────────────────
  const current = Array.isArray(ivRows[0].selected_outputs)
    ? ivRows[0].selected_outputs
    : (Array.isArray(ws.enabled_outputs) ? ws.enabled_outputs : [])
  const ids = channelIdsForAtomPlatform(platform)
  const next = enabled
    ? Array.from(new Set([...current, ...ids]))
    : current.filter((id) => !ids.includes(id))

  const ivPatch = await sb(`interviews?id=eq.${interviewId}&${wsFilter}`, {
    method: 'PATCH',
    body: JSON.stringify({ selected_outputs: next, updated_at: new Date().toISOString() }),
    headers: { Prefer: 'return=minimal' },
  })
  if (!ivPatch.ok) return err(res, 'Database error', 500)

  // ── Skip / restore the channel's atoms ─────────────────────────────────────
  const atomsRes = await sb(
    `content_plan_atoms?interview_id=eq.${interviewId}&platform=eq.${platform}&${wsFilter}` +
    `&select=id,status,content_piece_id,content_piece:content_items!content_piece_id(published_at)`
  )
  if (!atomsRes.ok) return err(res, 'Database error', 500)
  const atoms = await atomsRes.json()

  const now = new Date().toISOString()
  let affected = 0

  async function patchIds(idList, body) {
    if (!idList.length) return true
    const r = await sb(`content_plan_atoms?id=in.(${idList.join(',')})&${wsFilter}`, {
      method: 'PATCH',
      body: JSON.stringify({ ...body, updated_at: now }),
      headers: { Prefer: 'return=minimal' },
    })
    return r.ok
  }

  if (!enabled) {
    // Remove: skip every non-published atom not already skipped. A published
    // post is live on the channel and must never be hidden by a plan edit.
    const toSkip = atoms
      .filter((a) => a.status !== 'skipped' && !a.content_piece?.published_at)
      .map((a) => a.id)
    if (!(await patchIds(toSkip, { status: 'skipped' }))) return err(res, 'Database error', 500)
    affected = toSkip.length
  } else {
    // Restore: bring skipped atoms back. Those with a content piece return to
    // 'drafted' (the draft still exists); the rest to 'pending'.
    const skipped = atoms.filter((a) => a.status === 'skipped')
    const toDrafted = skipped.filter((a) => a.content_piece_id).map((a) => a.id)
    const toPending = skipped.filter((a) => !a.content_piece_id).map((a) => a.id)
    if (!(await patchIds(toDrafted, { status: 'drafted' }))) return err(res, 'Database error', 500)
    if (!(await patchIds(toPending, { status: 'pending' }))) return err(res, 'Database error', 500)
    affected = skipped.length
  }

  return ok(res, { ok: true, platform, enabled, selected_outputs: next, affected })
}
