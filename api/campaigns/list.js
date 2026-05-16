// List campaigns for the current workspace. Returns the campaign rows plus
// a contributed_count + contributed_clinician_ids derived from interviews
// tagged with this campaign_id where the interviewer actually fired (i.e.
// messages length > 0). This is the data the Stories campaign progress strip
// renders ("4 of 8 clinicians have contributed").
//
// Node runtime + (req, res) shape per CLAUDE.md (Edge bundler can't follow
// the ratelimit.js → @clerk/backend → node:crypto chain).

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
      ...init.headers,
    },
  })
}

async function dbErr(res, r, msg = 'Database error', status = 500) {
  const body = await r.text().catch(() => '')
  console.error(`[campaigns/list] ${msg} — supabase ${r.status}: ${body.slice(0, 500)}`)
  return res.status(status).json({ error: msg })
}

const CAMPAIGN_FIELDS = 'id,name,description,status,target_clinician_ids,created_at,updated_at'

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }
  if (!(await enforceLimit(req, res, 'default'))) return

  const ws = await workspaceContext(req)
  if (!ws) return res.status(400).json({ error: 'Workspace not resolved' })

  // 1. Pull campaigns for this workspace.
  const campR = await sb(
    `campaigns?workspace_id=eq.${ws.id}&select=${CAMPAIGN_FIELDS}&order=created_at.desc`,
  )
  if (!campR.ok) return dbErr(res, campR)
  const campaigns = await campR.json()

  if (!Array.isArray(campaigns) || campaigns.length === 0) {
    return res.status(200).json([])
  }

  // 2. Pull interviews tagged to any of these campaigns, in this workspace,
  //    where messages has at least one element (interviewer fired).
  //    Use PostgREST's `not.is.null` + `messages=neq.[]` to filter fired ones.
  const ids = campaigns.map((c) => c.id)
  const ivR = await sb(
    `interviews?workspace_id=eq.${ws.id}` +
      `&campaign_id=in.(${ids.map(encodeURIComponent).join(',')})` +
      `&select=campaign_id,clinician_id,messages` +
      `&messages=neq.[]`,
  )
  if (!ivR.ok) return dbErr(res, ivR)
  const interviews = await ivR.json()

  // 3. Roll up distinct clinician_ids per campaign.
  const contribByCampaign = new Map() // campaign_id → Set<clinician_id>
  for (const iv of interviews) {
    if (!iv?.campaign_id || !iv?.clinician_id) continue
    // Defense in depth: even though messages=neq.[] filters above, double-check
    // the array isn't empty in case the JSONB filter ever shifts shape.
    if (Array.isArray(iv.messages) && iv.messages.length === 0) continue
    let set = contribByCampaign.get(iv.campaign_id)
    if (!set) {
      set = new Set()
      contribByCampaign.set(iv.campaign_id, set)
    }
    set.add(iv.clinician_id)
  }

  const out = campaigns.map((c) => {
    const set = contribByCampaign.get(c.id) || new Set()
    return {
      ...c,
      contributed_clinician_ids: [...set],
      contributed_count: set.size,
    }
  })

  return res.status(200).json(out)
}
