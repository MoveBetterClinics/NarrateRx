import { withSentry } from '../_lib/sentry.js'
export const config = { runtime: 'nodejs' }
// GET /api/onboarding/my-workspaces
//
// Returns:
//   - workspaces: active workspaces the signed-in user already belongs to
//     (via Clerk org membership). Used by the apex /onboard auth step so a
//     returning user who signs in is offered "go to your workspace" instead
//     of being marched into the new-workspace wizard.
//   - suggested: active workspaces whose registered website domain matches
//     the user's primary-email domain but where the user is NOT yet a member.
//     Catches the "alli@movebetter.co signs up and accidentally creates a
//     duplicate Move Better workspace" case — the wizard surfaces these as
//     "ask your admin to invite you" and blocks the create-anyway path.
//
// Response: { workspaces: [...], suggested: [...] }
//   Each entry: { slug, display_name, url }
//   - empty arrays are valid (new user, no domain match) — the wizard then
//     continues to the business-basics step as before.
//
// Auth: Bearer Clerk JWT for any signed-in user. No org/role gate.

import { createClerkClient, verifyToken } from '@clerk/backend'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY
const CLERK_SECRET = process.env.CLERK_SECRET_KEY

let _clerk = null
function clerk() {
  if (!_clerk) _clerk = createClerkClient({ secretKey: CLERK_SECRET })
  return _clerk
}

async function authUserId(req) {
  const header = req.headers?.authorization || req.headers?.Authorization || ''
  const token  = header.startsWith('Bearer ') ? header.slice(7).trim() : null
  if (!token) return null
  try {
    const payload = await verifyToken(token, { secretKey: CLERK_SECRET })
    return payload?.sub || null
  } catch (e) {
    console.error('[my-workspaces] verifyToken failed:', e?.message)
    return null
  }
}

async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'method-not-allowed' })
  }
  if (!SUPABASE_URL || !SUPABASE_KEY || !CLERK_SECRET) {
    console.error('[my-workspaces] env not configured')
    return res.status(500).json({ error: 'server-misconfigured' })
  }

  const userId = await authUserId(req)
  if (!userId) return res.status(401).json({ error: 'unauthenticated' })

  // 1. Enumerate the user's Clerk org memberships AND grab their primary
  //    email (for the domain-match suggestion path below).
  let orgIds = []
  let emailDomain = null
  try {
    const [memberships, user] = await Promise.all([
      clerk().users.getOrganizationMembershipList({ userId, limit: 100 }),
      clerk().users.getUser(userId),
    ])
    const data = Array.isArray(memberships?.data) ? memberships.data : memberships
    orgIds = (data || [])
      .map(m => m?.organization?.id)
      .filter(Boolean)
    const primaryId = user?.primaryEmailAddressId
    const primary = user?.emailAddresses?.find(e => e.id === primaryId)
      || user?.emailAddresses?.[0]
    const addr = primary?.emailAddress || ''
    const at = addr.lastIndexOf('@')
    if (at > 0) emailDomain = normalizeDomain(addr.slice(at + 1))
  } catch (e) {
    console.error('[my-workspaces] clerk lookup failed:', e?.message)
    return res.status(500).json({ error: 'clerk-error' })
  }

  // 2. Look up active workspaces tied to those orgs.
  let workspaces = []
  if (orgIds.length > 0) {
    const inList = orgIds.map(id => `"${id}"`).join(',')
    const url = `${SUPABASE_URL}/rest/v1/workspaces?status=eq.active&clerk_org_id=in.(${encodeURIComponent(inList)})&select=slug,display_name,clerk_org_id`
    const rows = await sbGet(url)
    if (rows == null) return res.status(500).json({ error: 'db-error' })
    workspaces = rows.map(row => ({
      slug: row.slug,
      display_name: row.display_name,
      url: `https://${row.slug}.narraterx.ai`,
    }))
  }

  // 3. Domain-match suggestions: active workspaces whose registered website
  //    domain matches the user's email domain, minus any the user already
  //    belongs to. Skips common public mailbox domains so a gmail.com signup
  //    doesn't get matched against random tenants who happen to have a gmail
  //    URL on file.
  let suggested = []
  if (emailDomain && !PUBLIC_EMAIL_DOMAINS.has(emailDomain)) {
    const url = `${SUPABASE_URL}/rest/v1/workspaces?status=eq.active&website_hostname=not.is.null&select=slug,display_name,website_hostname,clerk_org_id`
    const rows = await sbGet(url)
    if (rows != null) {
      const myOrgSet = new Set(orgIds)
      suggested = rows
        .filter(row => normalizeDomain(row.website_hostname) === emailDomain)
        .filter(row => !myOrgSet.has(row.clerk_org_id))
        .map(row => ({
          slug: row.slug,
          display_name: row.display_name,
          url: `https://${row.slug}.narraterx.ai`,
        }))
    }
  }

  res.setHeader('Cache-Control', 'no-store')
  return res.status(200).json({ workspaces, suggested })
}

async function sbGet(url) {
  try {
    const r = await fetch(url, {
      headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
    })
    if (!r.ok) {
      console.error(`[my-workspaces] supabase ${r.status}`)
      return null
    }
    const rows = await r.json().catch(() => null)
    return Array.isArray(rows) ? rows : null
  } catch (e) {
    console.error('[my-workspaces] supabase network:', e?.message)
    return null
  }
}

function normalizeDomain(host) {
  if (typeof host !== 'string') return null
  return host.trim().toLowerCase().replace(/^www\./, '') || null
}

// Public mailbox providers are NOT suitable as a join signal — a user
// signing up with gmail.com shouldn't get matched against any tenant who
// happens to have a gmail URL on file. The set is intentionally small;
// corporate domains (movebetter.co, etc.) drive the match.
const PUBLIC_EMAIL_DOMAINS = new Set([
  'gmail.com', 'googlemail.com',
  'yahoo.com', 'yahoo.co.uk', 'ymail.com',
  'hotmail.com', 'outlook.com', 'live.com', 'msn.com',
  'icloud.com', 'me.com', 'mac.com',
  'aol.com', 'protonmail.com', 'proton.me',
  'pm.me', 'gmx.com', 'zoho.com', 'fastmail.com',
])

export default withSentry(handler)
