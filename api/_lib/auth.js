// Clerk-backed role gate for API routes.
//
// Reads a Bearer JWT from the inbound request, verifies it with @clerk/backend,
// looks up the user, then checks their `publicMetadata.role`. Returns a result
// object — the caller decides how to respond on failure so it can keep its own
// shape (some endpoints want 401 vs 403 split, some want a generic 'forbidden').
//
// Roles (see api/_lib/roles.js for canonical persona model):
//   admin     — workspace owner; configures NarrateRx; can purge
//   publisher — publishes content (attach media, schedule, publish, monitor)
//               LEGACY ALIAS: 'editor' — still authorizes via STAFF_ROLES
//   clinician — owns voice; records interviews, reviews drafts; upload only
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

// In-process user cache. verifyToken() is local crypto (fast); getUser() hits
// the Clerk API on every request — expensive when a page fires 4-5 parallel
// calls. Roles change only via admin action in Clerk dashboard, so a 60s lag
// is acceptable. TTL intentionally short so role grants take effect promptly.
const _userCache = new Map() // userId → { user, expiresAt }
const USER_TTL_MS = 60_000

function getCachedUser(userId) {
  const entry = _userCache.get(userId)
  if (!entry) return null
  if (Date.now() > entry.expiresAt) { _userCache.delete(userId); return null }
  return entry.user
}

function setCachedUser(userId, user) {
  _userCache.set(userId, { user, expiresAt: Date.now() + USER_TTL_MS })
}

// Workspace-plan lookup by Clerk org id. Used to grant admin-equivalent role
// to every member of an 'internal' workspace (Move Better-owned tenants).
// Same 60s TTL as user cache — plan changes are operational and rare.
const _orgPlanCache = new Map() // clerkOrgId → { plan, expiresAt }
const ORG_PLAN_TTL_MS = 60_000

async function lookupWorkspacePlanByOrgId(orgId) {
  if (!orgId) return null
  const cached = _orgPlanCache.get(orgId)
  if (cached && Date.now() < cached.expiresAt) return cached.plan
  const supabaseUrl = process.env.SUPABASE_URL
  const supabaseKey = process.env.SUPABASE_SERVICE_KEY
  if (!supabaseUrl || !supabaseKey) return null
  const url = `${supabaseUrl}/rest/v1/workspaces?clerk_org_id=eq.${encodeURIComponent(orgId)}&select=plan&limit=1`
  try {
    const r = await fetch(url, {
      headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` },
    })
    if (!r.ok) return null
    const rows = await r.json().catch(() => null)
    const plan = Array.isArray(rows) && rows[0] ? (rows[0].plan || null) : null
    _orgPlanCache.set(orgId, { plan, expiresAt: Date.now() + ORG_PLAN_TTL_MS })
    return plan
  } catch (e) {
    console.error('[auth] lookupWorkspacePlanByOrgId failed:', e?.message)
    return null
  }
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

  let user = getCachedUser(userId)
  if (!user) {
    try {
      user = await clerk().users.getUser(userId)
      if (user) setCachedUser(userId, user)
    } catch (e) {
      console.error('[auth] getUser failed:', e?.message)
      return { ok: false, reason: 'no-user' }
    }
  }
  if (!user) return { ok: false, reason: 'no-user' }

  // Clerk Organization admins are treated as NarrateRx admins for the active
  // workspace, regardless of their publicMetadata.role. This lets workspace
  // owners modify settings without a separate user-level role grant.
  //
  // 'internal' plan workspaces (Move Better-owned tenants) grant admin to
  // every org member — full feature + admin access without per-user grants.
  const metadataRole   = (user.publicMetadata?.role || 'clinician').toLowerCase()
  const isOrgAdmin     = payload.org_role === 'org:admin'
  const wsPlan         = await lookupWorkspacePlanByOrgId(payload.org_id)
  const internalBypass = wsPlan === 'internal'
  const role = (isOrgAdmin || internalBypass) ? 'admin' : metadataRole
  if (allowedRoles && allowedRoles.length && !allowedRoles.includes(role)) {
    return { ok: false, reason: 'forbidden', role, userId }
  }

  // Attach to req for downstream code (audit log).
  req.clerk = { userId, role, orgId: payload.org_id ?? null }
  return { ok: true, user: { id: userId, role }, role, userId, orgId: payload.org_id ?? null }
}

// ─────────────────────────────────────────────────────────────────────────────
// Phase 4: per-workspace permission_tier gate.
// ─────────────────────────────────────────────────────────────────────────────
// requireTier looks up clinicians.permission_tier for the calling user in the
// given workspace and verifies it's in the allow list. Returns the same
// {ok, reason, tier, userId} shape as requireRole so callers can use the same
// pattern: `if (!auth.ok) return res.status(...).json({error: auth.reason})`.
//
// IMPORTANT: requireTier does NOT replace requireRole. Callers that already
// pass requireRole and only need the tier as a defense-in-depth check can
// call requireTier after. Owners (org admins or internal-plan members) bypass
// tier gating — they're already trusted across the board.
//
// Usage:
//   const ws = await workspaceContext(req)
//   const auth = await requireRole(req, ALL_KNOWN_ROLES, { orgId: ws.clerk_org_id })
//   if (!auth.ok) return res.status(401).json({ error: auth.reason })
//   const tierAuth = await requireTier(req, ws, [TIER_OWNER, TIER_PRODUCER])
//   if (!tierAuth.ok) return res.status(403).json({ error: tierAuth.reason })

const SUPABASE_URL_FOR_TIER = process.env.SUPABASE_URL
const SUPABASE_KEY_FOR_TIER = process.env.SUPABASE_SERVICE_KEY

export async function lookupPermissionTier(userId, workspaceId) {
  if (!userId || !workspaceId) return null
  try {
    const r = await fetch(
      `${SUPABASE_URL_FOR_TIER}/rest/v1/clinicians?user_id=eq.${encodeURIComponent(userId)}` +
      `&workspace_id=eq.${encodeURIComponent(workspaceId)}&select=permission_tier&limit=1`,
      {
        headers: {
          apikey: SUPABASE_KEY_FOR_TIER,
          Authorization: `Bearer ${SUPABASE_KEY_FOR_TIER}`,
        },
      }
    )
    if (!r.ok) return null
    const rows = await r.json().catch(() => [])
    return rows?.[0]?.permission_tier || null
  } catch {
    return null
  }
}

/**
 * Gate a request on the caller's per-workspace permission_tier.
 * Assumes requireRole has already passed (req.clerk is populated) — falls
 * back to verifying the JWT inline if not.
 *
 * @param {Request} req
 * @param {{id: string, plan?: string}} workspace
 * @param {string[]} allowedTiers
 * @returns {Promise<{ok: boolean, reason?: string, tier?: string, userId?: string}>}
 */
export async function requireTier(req, workspace, allowedTiers) {
  if (!workspace?.id) return { ok: false, reason: 'no-workspace-context' }

  // Resolve userId — prefer the already-validated req.clerk.userId from a
  // prior requireRole call, otherwise verify the Bearer JWT here.
  let userId = req.clerk?.userId
  if (!userId) {
    const verify = await requireRole(req, null, { orgId: workspace.clerk_org_id })
    if (!verify.ok) return { ok: false, reason: verify.reason }
    userId = verify.userId
  }

  // Internal-plan workspaces and Clerk org admins bypass tier gating —
  // they're trusted across all surfaces (mirrors the admin bypass in
  // requireRole). Without this, the org owner gets locked out of producer-
  // gated routes by default since their clinicians row defaults to 'clinician'.
  if (workspace.plan === 'internal' || req.clerk?.role === 'admin') {
    return { ok: true, tier: 'owner', userId, bypassed: true }
  }

  const tier = await lookupPermissionTier(userId, workspace.id) || 'clinician'
  if (allowedTiers && allowedTiers.length && !allowedTiers.includes(tier)) {
    return { ok: false, reason: 'forbidden-tier', tier, userId }
  }
  return { ok: true, tier, userId }
}
