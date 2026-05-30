// GET /api/workspace/access-matrix
//
// Returns every staff member in the caller's workspace with their resolved
// capability set, the raw per-person overrides, and the tier-only capability
// set (so the client can diff "custom override" vs "tier default" per cell).
// Also folds in pending Clerk invitations so unaccepted invites appear as rows.
//
// Powers /settings/access (the capability matrix). Gated on members.invite.

import { withSentry } from '../_lib/sentry.js'
import { workspaceContext } from '../_lib/workspaceContext.js'
import { requireRole, requireCapability } from '../_lib/auth.js'
import { resolveCapabilities, CAP_MEMBERS_INVITE } from '../_lib/capabilities.js'
import { enforceLimit } from '../_lib/ratelimit.js'

export const config = { runtime: 'nodejs' }

async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const workspace = await workspaceContext(req)
  if (!workspace) return res.status(404).json({ error: 'Workspace not found' })

  const auth = await requireRole(req, null, { orgId: workspace.clerk_org_id })
  if (!auth.ok) {
    return res.status(auth.reason === 'forbidden' ? 403 : 401).json({ error: auth.reason })
  }

  // Gate on members.invite — owner-only by default; requireCapability handles
  // the org-admin bypass and per-tier resolution internally.
  const capAuth = await requireCapability(req, workspace, [CAP_MEMBERS_INVITE])
  if (!capAuth.ok) {
    return res.status(403).json({ error: capAuth.reason, missing: capAuth.missing })
  }

  if (!(await enforceLimit(req, res, 'access-matrix'))) return

  const SUPA = (process.env.SUPABASE_URL || '').replace(/\/$/, '')
  const SROLE = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY
  if (!SUPA || !SROLE) {
    return res.status(500).json({ error: 'Server not configured' })
  }

  try {
    const sres = await fetch(
      `${SUPA}/rest/v1/staff?workspace_id=eq.${workspace.id}` +
        `&select=id,name,legal_name,permission_tier,staff_type,capability_overrides,user_id,producer_onboarded_at,active_voice_clone_id` +
        `&order=name.asc`,
      { headers: { apikey: SROLE, Authorization: `Bearer ${SROLE}` } }
    )
    if (!sres.ok) {
      console.error('[workspace/access-matrix] staff fetch failed:', sres.status, await sres.text())
      return res.status(502).json({ error: 'Failed to load staff' })
    }
    const staffRows = await sres.json()

    const staff = staffRows.map((s) => ({
      id: s.id,
      name: s.name,
      legal_name: s.legal_name || null,
      permission_tier: s.permission_tier || 'clinician',
      staff_type: s.staff_type || 'clinician',
      capability_overrides: s.capability_overrides || {},
      user_id: s.user_id || null,
      producer_onboarded_at: s.producer_onboarded_at || null,
      has_voice_clone: !!s.active_voice_clone_id,
      pending: false,
      // tier-only set (no overrides) — lets the client diff each cell
      tier_capabilities: resolveCapabilities(s.permission_tier || 'clinician', workspace),
      // effective set (tier + overrides)
      resolved_capabilities: resolveCapabilities(
        s.permission_tier || 'clinician',
        workspace,
        s.capability_overrides
      ),
      is_self: !!s.user_id && s.user_id === auth.userId,
    }))

    // Pending Clerk invitations — non-fatal: [] degrades gracefully.
    let pending = []
    try {
      if (auth.orgId && process.env.CLERK_SECRET_KEY) {
        const cres = await fetch(
          `https://api.clerk.com/v1/organizations/${auth.orgId}/invitations?status=pending&limit=50`,
          { headers: { Authorization: `Bearer ${process.env.CLERK_SECRET_KEY}` } }
        )
        if (cres.ok) {
          const body = await cres.json()
          const list = Array.isArray(body?.data) ? body.data : []
          pending = list.map((inv) => ({
            id: `invite_${inv.id}`,
            name: inv.email_address,
            legal_name: null,
            permission_tier: 'clinician',
            staff_type: 'clinician',
            capability_overrides: {},
            user_id: null,
            producer_onboarded_at: null,
            has_voice_clone: false,
            pending: true,
            tier_capabilities: resolveCapabilities('clinician', workspace),
            resolved_capabilities: resolveCapabilities('clinician', workspace),
            is_self: false,
          }))
        }
      }
    } catch (e) {
      console.error('[workspace/access-matrix] pending invites fetch failed:', e?.message)
    }

    return res.status(200).json({ staff: [...staff, ...pending], workspace_id: workspace.id })
  } catch (e) {
    console.error('[workspace/access-matrix] error:', e?.stack || e?.message)
    return res.status(500).json({ error: 'Database error' })
  }
}

export default withSentry(handler)
