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
import { fetchClerkMembers } from '../_lib/clerkOrg.js'

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
        `&select=id,name,legal_name,permission_tier,staff_type,capability_overrides,user_id,eleven_voice_id,created_by_email,created_at` +
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
      has_voice_clone: !!s.eleven_voice_id,
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

    // ── Reconciliation: drift between Clerk membership and the staff table, so
    //    the owner can fix splits/gaps from the matrix instead of via SQL.
    //    Non-fatal — members_checked=false means the Clerk fetch failed and the
    //    member-dependent lists are empty rather than wrong.
    let reconciliation = {
      members_checked: false,
      members_without_staff: [],
      duplicate_emails: [],
      claimable_proxies: [],
    }
    try {
      const members =
        auth.orgId && process.env.CLERK_SECRET_KEY ? await fetchClerkMembers(auth.orgId) : []
      const membersChecked = members.length > 0
      const boundUserIds = new Set(staffRows.filter((s) => s.user_id).map((s) => s.user_id))
      const emailToMember = new Map()
      for (const m of members) if (m.email) emailToMember.set(m.email.toLowerCase(), m)

      // (c) Unclaimed proxy rows whose created_by_email maps to a real member →
      //     directly claimable. has_bound_sibling marks the split case where a
      //     bound row already exists for the same email (fix = merge, not claim).
      const claimable_proxies = []
      const coveredMemberIds = new Set()
      for (const s of staffRows) {
        if (s.user_id) continue
        const e = (s.created_by_email || '').toLowerCase()
        if (!e) continue
        const member = emailToMember.get(e)
        if (!member) continue
        const sibling = staffRows.find(
          (o) => o.user_id && (o.created_by_email || '').toLowerCase() === e
        )
        claimable_proxies.push({
          staff_id: s.id,
          name: s.name,
          email: s.created_by_email,
          member_user_id: member.user_id,
          member_name: member.name,
          has_bound_sibling: !!sibling,
          bound_sibling_id: sibling ? sibling.id : null,
        })
        if (member.user_id) coveredMemberIds.add(member.user_id)
      }

      // (a) Active members with neither a bound row nor a claimable proxy — a
      //     true gap (they'll self-provision on next sign-in via ensure-self,
      //     but the owner can see the gap now).
      const members_without_staff = membersChecked
        ? members
            .filter((m) => m.user_id && !boundUserIds.has(m.user_id) && !coveredMemberIds.has(m.user_id))
            .map((m) => ({ user_id: m.user_id, email: m.email, name: m.name, role: m.role }))
        : []

      // (b) Emails on more than one staff row — but only when it's a real person
      //     (at least one row bound, or the email maps to a member). This skips
      //     benign fixtures like the two E2E Smoke rows that share a test email.
      const byEmail = new Map()
      for (const s of staffRows) {
        const e = (s.created_by_email || '').toLowerCase()
        if (!e) continue
        if (!byEmail.has(e)) byEmail.set(e, [])
        byEmail.get(e).push(s)
      }
      const duplicate_emails = []
      for (const [email, rows] of byEmail) {
        if (rows.length <= 1) continue
        if (!rows.some((r) => r.user_id) && !emailToMember.has(email)) continue
        duplicate_emails.push({
          email,
          staff: rows.map((r) => ({ id: r.id, name: r.name, user_id: r.user_id || null })),
        })
      }

      reconciliation = {
        members_checked: membersChecked,
        members_without_staff,
        duplicate_emails,
        claimable_proxies,
      }
    } catch (e) {
      console.error('[workspace/access-matrix] reconciliation failed:', e?.message)
    }

    return res.status(200).json({ staff: [...staff, ...pending], workspace_id: workspace.id, reconciliation })
  } catch (e) {
    console.error('[workspace/access-matrix] error:', e?.stack || e?.message)
    return res.status(500).json({ error: 'Database error' })
  }
}

export default withSentry(handler)
