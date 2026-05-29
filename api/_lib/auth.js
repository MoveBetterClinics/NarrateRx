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
//               LEGACY ALIAS: 'editor' — still authorizes via EDITOR_ROLES
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

  // Attach to req for downstream code (audit log + capability gates).
  // isOrgAdmin distinguishes a true Clerk org admin from an internal-plan
  // bypass member — Phase 4 capability gates need that distinction to know
  // when to fully bypass (org admin) vs when to consult the user's tier
  // (internal-plan member, e.g. a Producer at Move Better).
  req.clerk = { userId, role, orgId: payload.org_id ?? null, isOrgAdmin }
  return {
    ok: true,
    user: { id: userId, role },
    role, userId,
    orgId: payload.org_id ?? null,
    isOrgAdmin,
  }
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

/**
 * Look up clinicians.permission_tier for (userId, workspaceId).
 *
 * Returns a discriminated result so callers can distinguish "no row" (legacy
 * fallback) from "DB error" (must NOT fall back — would over-grant).
 *
 * @returns {Promise<{ ok: true, tier: string|null } | { ok: false, reason: string }>}
 */
export async function lookupPermissionTier(userId, workspaceId) {
  if (!userId || !workspaceId) return { ok: true, tier: null }
  try {
    const r = await fetch(
      `${SUPABASE_URL_FOR_TIER}/rest/v1/staff?user_id=eq.${encodeURIComponent(userId)}` +
      `&workspace_id=eq.${encodeURIComponent(workspaceId)}&select=permission_tier&limit=1`,
      {
        headers: {
          apikey: SUPABASE_KEY_FOR_TIER,
          Authorization: `Bearer ${SUPABASE_KEY_FOR_TIER}`,
        },
      }
    )
    if (!r.ok) {
      // Real DB error — caller MUST treat as fail-closed, not as "no tier."
      console.error(`[auth.lookupPermissionTier] db error: status=${r.status}`)
      return { ok: false, reason: 'tier-lookup-db-error' }
    }
    const rows = await r.json().catch(() => null)
    if (!Array.isArray(rows)) {
      console.error('[auth.lookupPermissionTier] db error: bad response shape')
      return { ok: false, reason: 'tier-lookup-bad-response' }
    }
    return { ok: true, tier: rows?.[0]?.permission_tier || null }
  } catch (e) {
    console.error('[auth.lookupPermissionTier] db error:', e?.message)
    return { ok: false, reason: 'tier-lookup-exception' }
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

  const lookup = await lookupPermissionTier(userId, workspace.id)
  if (!lookup.ok) {
    // Fail-closed on DB error — never silently fall back to 'clinician'
    // which would over-grant or wrongly deny.
    return { ok: false, reason: lookup.reason, userId }
  }
  const tier = lookup.tier || 'clinician'
  if (allowedTiers && allowedTiers.length && !allowedTiers.includes(tier)) {
    return { ok: false, reason: 'forbidden-tier', tier, userId }
  }
  return { ok: true, tier, userId }
}

// ─────────────────────────────────────────────────────────────────────────────
// Phase 4 PR 3: requireCapability — fine-grained server-side gate.
// ─────────────────────────────────────────────────────────────────────────────
// Pattern: call AFTER requireRole(['admin']) so the existing legacy gate runs
// first. requireCapability then layers a capability check that only fires
// when an admin has explicitly set the user's clinicians.permission_tier.
//
// Bypass rules (in order):
//   1. Clerk org admins (payload.org_role === 'org:admin') always bypass.
//      They own the workspace; they get all capabilities.
//   2. Users with NO explicit permission_tier set fall back to legacy
//      behavior: pass if requireRole already let them through. The
//      capability gate is opt-in per-user — an admin must explicitly set
//      someone's tier to start enforcing.
//   3. Users with an explicit tier are resolved against the workspace's
//      role_templates (with code defaults as fallback) and their effective
//      capability set is checked against requiredCapabilities.
//
// Usage:
//   const auth = await requireRole(req, ['admin'], { orgId: ws.clerk_org_id })
//   if (!auth.ok) return res.status(...).json({ error: auth.reason })
//   const capAuth = await requireCapability(req, ws, [CAP_BILLING_VIEW])
//   if (!capAuth.ok) return res.status(403).json({ error: capAuth.reason, missing: capAuth.missing })
//
// @returns {Promise<{
//   ok: boolean,
//   reason?: string,
//   tier?: string,
//   capabilities?: string[],
//   missing?: string[],
//   bypassed?: 'org-admin' | 'no-tier-fallback' | undefined,
//   userId?: string,
// }>}

import { resolveCapabilities, ALL_CAPABILITIES } from './capabilities.js'

export async function requireCapability(req, workspace, requiredCapabilities) {
  if (!workspace?.id) return { ok: false, reason: 'no-workspace-context' }
  if (!Array.isArray(requiredCapabilities) || requiredCapabilities.length === 0) {
    // No requirement = pass. Lets callers write requireCapability(req, ws, []).
    // userId intentionally absent here — callers using the no-op pattern
    // shouldn't be relying on it.
    return { ok: true, capabilities: [] }
  }

  // ALWAYS re-derive auth via requireRole — never trust pre-existing req.clerk
  // fields like isOrgAdmin. requireRole's userCache makes this cheap on the
  // second call within a single request (verifyToken is local crypto; getUser
  // is cached for 60s). This closes the spoof window where a caller could
  // construct req.clerk with isOrgAdmin: true outside of normal middleware.
  const verify = await requireRole(req, null, { orgId: workspace.clerk_org_id })
  if (!verify.ok) return { ok: false, reason: verify.reason }
  const { userId, role, isOrgAdmin } = verify

  // Rule 1: Clerk org:admin always bypasses.
  if (isOrgAdmin === true) {
    return { ok: true, capabilities: [...ALL_CAPABILITIES], bypassed: 'org-admin', userId }
  }

  // Look up tier. Distinguish "no row" (legacy fallback path) from "DB error"
  // (fail-closed — never silently grant on infra issues).
  const lookup = await lookupPermissionTier(userId, workspace.id)
  if (!lookup.ok) {
    return { ok: false, reason: lookup.reason, userId }
  }
  const explicitTier = lookup.tier

  // Rule 2: no explicit tier set → legacy fallback. If requireRole resolved
  // this user to 'admin' (internal-plan bypass), pass. Otherwise treat as
  // 'clinician' default template and enforce.
  if (!explicitTier) {
    if (role === 'admin') {
      return { ok: true, capabilities: [...ALL_CAPABILITIES], bypassed: 'no-tier-fallback', userId }
    }
    const fallbackCaps = resolveCapabilities('clinician', workspace)
    const missing = requiredCapabilities.filter((c) => !fallbackCaps.includes(c))
    if (missing.length) {
      return { ok: false, reason: 'forbidden-capability', missing, capabilities: fallbackCaps, tier: 'clinician', userId }
    }
    return { ok: true, capabilities: fallbackCaps, tier: 'clinician', userId }
  }

  // Rule 3: explicit tier → enforce capability template.
  const caps = resolveCapabilities(explicitTier, workspace)
  const missing = requiredCapabilities.filter((c) => !caps.includes(c))
  if (missing.length) {
    return { ok: false, reason: 'forbidden-capability', missing, capabilities: caps, tier: explicitTier, userId }
  }
  return { ok: true, capabilities: caps, tier: explicitTier, userId }
}
