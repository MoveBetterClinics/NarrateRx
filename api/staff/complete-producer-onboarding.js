// POST /api/staff/complete-producer-onboarding
//
// Phase 4 PR 4: marks the calling user's clinicians.producer_onboarded_at = NOW()
// in the active workspace. Idempotent — if already set, returns the existing
// timestamp without modifying.
//
// Body: (none)
// Response 200: { onboarded_at: ISO string }
// Errors: 401 / 404 / 500

export const config = { runtime: 'nodejs' }

import { requireRole } from '../_lib/auth.js'
import { ALL_KNOWN_ROLES } from '../_lib/roles.js'
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

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'method_not_allowed' })
  }

  const ws = await workspaceContext(req)
  if (!ws) return res.status(404).json({ error: 'no_workspace' })

  const auth = await requireRole(req, ALL_KNOWN_ROLES, { orgId: ws.clerk_org_id })
  if (!auth.ok) {
    return res.status(auth.reason === 'forbidden' ? 403 : 401).json({ error: auth.reason })
  }

  // Idempotent upsert: if the user has no clinicians row in this workspace,
  // we can't onboard them as a producer (the tier lookup would have failed
  // upstream). 404 instead of silently creating a row.
  const lookup = await sb(
    `staff?user_id=eq.${encodeURIComponent(auth.userId)}` +
    `&workspace_id=eq.${encodeURIComponent(ws.id)}&select=id,producer_onboarded_at&limit=1`
  )
  if (!lookup.ok) {
    return res.status(500).json({ error: 'db_lookup_failed' })
  }
  const rows = await lookup.json().catch(() => [])
  const clinician = rows?.[0]
  if (!clinician) {
    return res.status(404).json({ error: 'no_staff_row' })
  }

  // Idempotent: if already set, return existing timestamp.
  if (clinician.producer_onboarded_at) {
    return res.status(200).json({
      onboarded_at: clinician.producer_onboarded_at,
      already_complete: true,
    })
  }

  const now = new Date().toISOString()
  const patchRes = await sb(`staff?id=eq.${clinician.id}&workspace_id=eq.${ws.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ producer_onboarded_at: now }),
  })
  if (!patchRes.ok) {
    const text = await patchRes.text().catch(() => '')
    console.error('[complete-producer-onboarding] patch failed:', patchRes.status, text)
    return res.status(500).json({ error: 'db_update_failed' })
  }

  return res.status(200).json({ onboarded_at: now })
}
