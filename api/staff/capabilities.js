// PATCH /api/staff/capabilities
//
// Full-replace of one staff member's capability_overrides map. The matrix page
// builds the complete overrides object client-side and sends it on Save.
//
// Body: { id: <staff uuid>, overrides: { [capId]: boolean } }
//
// The staff id travels in the BODY (not the URL) because Vercel's file-based
// routing treats `[id]` path segments literally for Node handlers. Gated on
// members.invite.

import { withSentry } from '../_lib/sentry.js'
import { workspaceContext } from '../_lib/workspaceContext.js'
import { requireRole, requireCapability } from '../_lib/auth.js'
import {
  resolveCapabilities,
  ALL_CAPABILITIES,
  OWNER_ONLY_CAPABILITIES,
  CAP_MEMBERS_INVITE,
} from '../_lib/capabilities.js'
import { enforceLimit } from '../_lib/ratelimit.js'

export const config = { runtime: 'nodejs' }

async function handler(req, res) {
  if (req.method !== 'PATCH') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const workspace = await workspaceContext(req)
  if (!workspace) return res.status(404).json({ error: 'Workspace not found' })

  const auth = await requireRole(req, null, { orgId: workspace.clerk_org_id })
  if (!auth.ok) {
    return res.status(auth.reason === 'forbidden' ? 403 : 401).json({ error: auth.reason })
  }

  const capAuth = await requireCapability(req, workspace, [CAP_MEMBERS_INVITE])
  if (!capAuth.ok) {
    return res.status(403).json({ error: capAuth.reason, missing: capAuth.missing })
  }

  if (!(await enforceLimit(req, res, 'staff-capabilities'))) return

  const body = req.body || {}
  const targetId = body.id
  const overrides = body.overrides
  if (!targetId || typeof targetId !== 'string') {
    return res.status(400).json({ error: 'Missing staff id' })
  }
  if (typeof overrides !== 'object' || overrides === null || Array.isArray(overrides)) {
    return res.status(400).json({ error: 'overrides must be an object' })
  }

  const SUPA = (process.env.SUPABASE_URL || '').replace(/\/$/, '')
  const SROLE = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY
  if (!SUPA || !SROLE) {
    return res.status(500).json({ error: 'Server not configured' })
  }

  try {
    // Load the target staff row — must belong to the same workspace.
    const tres = await fetch(
      `${SUPA}/rest/v1/staff?id=eq.${encodeURIComponent(targetId)}&workspace_id=eq.${workspace.id}&select=id,permission_tier,user_id&limit=1`,
      { headers: { apikey: SROLE, Authorization: `Bearer ${SROLE}` } }
    )
    if (!tres.ok) {
      console.error('[staff/capabilities] target fetch failed:', tres.status, await tres.text())
      return res.status(502).json({ error: 'Database error' })
    }
    const [target] = await tres.json()
    if (!target) return res.status(404).json({ error: 'Staff member not found' })

    // Owner-tier staff are always all-caps — no overrides allowed.
    if (target.permission_tier === 'owner') {
      return res.status(400).json({ error: 'Owner capabilities cannot be modified' })
    }
    // No self-escalation.
    if (target.user_id && target.user_id === auth.userId) {
      return res.status(400).json({ error: 'You cannot modify your own capabilities' })
    }

    // Validate the overrides map.
    for (const [cap, val] of Object.entries(overrides)) {
      if (!ALL_CAPABILITIES.includes(cap)) {
        return res.status(400).json({ error: `Unknown capability: ${cap}` })
      }
      if (typeof val !== 'boolean') {
        return res.status(400).json({ error: `Value for ${cap} must be a boolean` })
      }
      if (val === true && OWNER_ONLY_CAPABILITIES.has(cap)) {
        return res
          .status(400)
          .json({ error: `${cap} is owner-only and cannot be granted to a ${target.permission_tier}` })
      }
    }

    // Write — full replace.
    const pres = await fetch(
      `${SUPA}/rest/v1/staff?id=eq.${encodeURIComponent(targetId)}&workspace_id=eq.${workspace.id}`,
      {
        method: 'PATCH',
        headers: {
          apikey: SROLE,
          Authorization: `Bearer ${SROLE}`,
          'Content-Type': 'application/json',
          Prefer: 'return=representation',
        },
        body: JSON.stringify({ capability_overrides: overrides }),
      }
    )
    if (!pres.ok) {
      console.error('[staff/capabilities] write failed:', pres.status, await pres.text())
      return res.status(502).json({ error: 'Failed to save' })
    }

    return res.status(200).json({
      ok: true,
      id: targetId,
      overrides,
      resolved_capabilities: resolveCapabilities(target.permission_tier, workspace, overrides),
    })
  } catch (e) {
    console.error('[staff/capabilities] error:', e?.stack || e?.message)
    return res.status(500).json({ error: 'Database error' })
  }
}

export default withSentry(handler)
