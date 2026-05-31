// POST /api/staff/reconcile
//
// Owner-only reconciliation actions for the access matrix. Turns the manual
// "Clerk members vs staff table" audit into one-click fixes:
//
//   { action: 'claim', staffId, userId }     bind an unclaimed proxy row to a
//                                             member (the durable fix for a
//                                             stranded proxy whose Clerk display
//                                             name never matched ensure-self)
//   { action: 'merge', sourceId, targetId }  fold one staff row into another,
//                                             repointing all learning, via the
//                                             atomic merge_staff() RPC
//
// Gated on members.invite (owner / org-admin). Node runtime — (req, res) shape,
// res.status().json(), never `new Response`.

import { withSentry } from '../_lib/sentry.js'
import { workspaceContext } from '../_lib/workspaceContext.js'
import { requireRole, requireCapability } from '../_lib/auth.js'
import { CAP_MEMBERS_INVITE } from '../_lib/capabilities.js'
import { enforceLimit } from '../_lib/ratelimit.js'
import { fetchClerkMembers } from '../_lib/clerkOrg.js'

export const config = { runtime: 'nodejs' }

async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

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

  const SUPA = (process.env.SUPABASE_URL || '').replace(/\/$/, '')
  const SROLE = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY
  if (!SUPA || !SROLE) return res.status(500).json({ error: 'Server not configured' })

  const sb = (path, init = {}) =>
    fetch(`${SUPA}/rest/v1/${path}`, {
      ...init,
      headers: {
        apikey: SROLE,
        Authorization: `Bearer ${SROLE}`,
        'Content-Type': 'application/json',
        ...init.headers,
      },
    })

  const body = req.body || {}
  const action = body.action

  try {
    // ── claim ───────────────────────────────────────────────────────────────
    if (action === 'claim') {
      const staffId = String(body.staffId || '')
      const userId = String(body.userId || '')
      if (!staffId || !userId) return res.status(400).json({ error: 'Missing staffId or userId' })

      // The claim target must be a real member of this org — never bind a row
      // to an arbitrary Clerk id.
      const members = await fetchClerkMembers(auth.orgId)
      if (members.length && !members.some((m) => m.user_id === userId)) {
        return res.status(400).json({ error: 'Target user is not a member of this workspace' })
      }

      // That member must not already own a row here — binding a second one would
      // create the very duplicate we're trying to prevent. Merge instead.
      const dupRes = await sb(
        `staff?workspace_id=eq.${workspace.id}&user_id=eq.${encodeURIComponent(userId)}&select=id&limit=1`
      )
      if (dupRes.ok) {
        const dup = await dupRes.json()
        if (Array.isArray(dup) && dup.length) {
          return res
            .status(409)
            .json({ error: 'That member already has a staff row — merge instead', existingId: dup[0].id })
        }
      }

      // Conditional claim: PATCH only while still unclaimed (user_id is null),
      // mirroring the race guard in ensure-self.js.
      const claimRes = await sb(
        `staff?id=eq.${encodeURIComponent(staffId)}&workspace_id=eq.${workspace.id}&user_id=is.null&select=id,name,user_id,permission_tier`,
        {
          method: 'PATCH',
          headers: { Prefer: 'return=representation' },
          body: JSON.stringify({ user_id: userId, updated_at: new Date().toISOString() }),
        }
      )
      if (!claimRes.ok) {
        console.error('[staff/reconcile] claim write failed:', claimRes.status, await claimRes.text().catch(() => ''))
        return res.status(502).json({ error: 'Claim failed' })
      }
      const claimed = await claimRes.json()
      if (!Array.isArray(claimed) || claimed.length === 0) {
        return res.status(409).json({ error: 'Row was already claimed or not found' })
      }
      return res.status(200).json({ ok: true, action: 'claim', staffMember: claimed[0] })
    }

    // ── merge ───────────────────────────────────────────────────────────────
    if (action === 'merge') {
      const sourceId = String(body.sourceId || '')
      const targetId = String(body.targetId || '')
      if (!sourceId || !targetId) return res.status(400).json({ error: 'Missing sourceId or targetId' })
      if (sourceId === targetId) return res.status(400).json({ error: 'Source and target are the same row' })

      // Both rows must live in this workspace (defense-in-depth — merge_staff()
      // re-checks, but fail fast with a clear message and never leak the RPC's
      // existence of cross-tenant ids).
      const bothRes = await sb(
        `staff?id=in.(${encodeURIComponent(sourceId)},${encodeURIComponent(targetId)})` +
          `&workspace_id=eq.${workspace.id}&select=id`
      )
      if (!bothRes.ok) {
        console.error('[staff/reconcile] merge lookup failed:', bothRes.status, await bothRes.text().catch(() => ''))
        return res.status(502).json({ error: 'Lookup failed' })
      }
      const both = await bothRes.json()
      if (!Array.isArray(both) || both.length !== 2) {
        return res.status(404).json({ error: 'Both rows must exist in this workspace' })
      }

      const rpcRes = await sb('rpc/merge_staff', {
        method: 'POST',
        body: JSON.stringify({ p_source: sourceId, p_target: targetId, p_workspace: workspace.id }),
      })
      if (!rpcRes.ok) {
        const t = await rpcRes.text().catch(() => '')
        console.error('[staff/reconcile] merge rpc failed:', rpcRes.status, t)
        return res.status(502).json({ error: 'Merge failed' })
      }
      return res.status(200).json({ ok: true, action: 'merge', targetId })
    }

    return res.status(400).json({ error: 'Unknown action' })
  } catch (e) {
    console.error('[staff/reconcile] error:', e?.stack || e?.message)
    return res.status(500).json({ error: 'Server error' })
  }
}

export default withSentry(handler)
