// Clerk-backed role gate for API routes.
//
// Reads a Bearer JWT from the inbound request, verifies it with @clerk/backend,
// looks up the user, then checks their `publicMetadata.role`. Returns a result
// object — the caller decides how to respond on failure so it can keep its own
// shape (some endpoints want 401 vs 403 split, some want a generic 'forbidden').
//
// Roles (Locked decisions in HANDOFF.md):
//   admin     — upload, edit, archive, restore, purge
//   editor    — upload, edit, archive, restore
//   clinician — upload, edit own metadata only
//
// Default role for users with no publicMetadata.role set is 'clinician' — the
// least-privileged tier. Only an admin can grant elevated roles via Clerk.
//
// Phase 1B: optional orgId check. When a workspace's clerk_org_id is passed,
// verifies that the JWT's org_id claim matches. The frontend OrgGate calls
// setActive({ organization }) so the JWT includes org_id for workspace-scoped
// subdomains. Endpoints can opt in via the third parameter:
//
//   const ws = await workspaceContext(req)
//   const auth = await requireRole(req, ['admin'], { orgId: ws?.clerk_org_id })
//   if (!auth.ok) return res.status(auth.reason === 'forbidden' ? 403 : 401)
//                          .json({ error: auth.reason })

import { createClerkClient, verifyToken } from '@clerk/backend'

const CLERK_SECRET = process.env.CLERK_SECRET_KEY

let _clerk = null
function clerk() {
  if (!_clerk) _clerk = createClerkClient({ secretKey: CLERK_SECRET })
  return _clerk
}

export async function requireRole(req, allowedRoles = null, { orgId = null } = {}) {
  if (!CLERK_SECRET) {
    // Fail closed. A missing secret is an ops misconfiguration, not a reason
    // to grant access. Surface clearly in logs so it's easy to diagnose.
    console.error('[auth] CLERK_SECRET_KEY is not set; refusing request')
    return { ok: false, reason: 'server-misconfigured' }
  }

  const header = req.headers?.authorization || req.headers?.Authorization || ''
  const token  = header.startsWith('Bearer ') ? header.slice(7).trim() : null
  if (!token) return { ok: false, reason: 'no-token' }

  let payload
  try {
    payload = await verifyToken(token, { secretKey: CLERK_SECRET })
  } catch (e) {
    console.error('[auth] verifyToken failed:', e?.message)
    return { ok: false, reason: 'invalid-token' }
  }

  const userId = payload.sub
  if (!userId) return { ok: false, reason: 'no-user' }

  // Workspace org membership check. The frontend OrgGate activates the matching
  // org so payload.org_id is set for all workspace-subdomain requests.
  if (orgId && payload.org_id !== orgId) {
    console.error(`[auth] org mismatch: expected ${orgId}, got ${payload.org_id}`)
    return { ok: false, reason: 'wrong-org' }
  }

  let user
  try {
    user = await clerk().users.getUser(userId)
  } catch (e) {
    console.error('[auth] getUser failed:', e?.message)
    return { ok: false, reason: 'no-user' }
  }
  if (!user) return { ok: false, reason: 'no-user' }

  // Clerk Organization admins are treated as NarrateRx admins for the active
  // workspace, regardless of their publicMetadata.role. This lets workspace
  // owners modify settings without a separate user-level role grant.
  const metadataRole = (user.publicMetadata?.role || 'clinician').toLowerCase()
  const isOrgAdmin   = payload.org_role === 'org:admin'
  const role = isOrgAdmin ? 'admin' : metadataRole
  if (allowedRoles && allowedRoles.length && !allowedRoles.includes(role)) {
    return { ok: false, reason: 'forbidden', role, userId }
  }

  // Attach to req for downstream code (audit log).
  req.clerk = { userId, role, orgId: payload.org_id ?? null }
  return { ok: true, user: { id: userId, role }, role, userId, orgId: payload.org_id ?? null }
}
