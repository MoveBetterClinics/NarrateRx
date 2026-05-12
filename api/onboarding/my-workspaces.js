import { withSentry } from '../_lib/sentry.js'
// GET /api/onboarding/my-workspaces
//
// Returns the active workspaces the signed-in user belongs to (via Clerk org
// membership). Used by the apex /onboard auth step so a returning user who
// signs in is offered "go to your workspace" instead of being marched into
// the new-workspace wizard.
//
// Response: { workspaces: [{ slug, display_name, url }] }
//   - empty array is valid (new user) — the wizard then continues to the
//     business-basics step as before.
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

  // 1. Enumerate the user's Clerk org memberships.
  let orgIds = []
  try {
    const memberships = await clerk().users.getOrganizationMembershipList({ userId, limit: 100 })
    const data = Array.isArray(memberships?.data) ? memberships.data : memberships
    orgIds = (data || [])
      .map(m => m?.organization?.id)
      .filter(Boolean)
  } catch (e) {
    console.error('[my-workspaces] clerk membership list failed:', e?.message)
    return res.status(500).json({ error: 'clerk-error' })
  }

  if (orgIds.length === 0) {
    return res.status(200).json({ workspaces: [] })
  }

  // 2. Look up active workspaces tied to those orgs.
  const inList = orgIds.map(id => `"${id}"`).join(',')
  const url = `${SUPABASE_URL}/rest/v1/workspaces?status=eq.active&clerk_org_id=in.(${encodeURIComponent(inList)})&select=slug,display_name`
  let r
  try {
    r = await fetch(url, {
      headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
    })
  } catch (e) {
    console.error('[my-workspaces] supabase network:', e?.message)
    return res.status(500).json({ error: 'db-error' })
  }
  if (!r.ok) {
    console.error(`[my-workspaces] supabase ${r.status}`)
    return res.status(500).json({ error: 'db-error' })
  }
  const rows = await r.json().catch(() => null)
  if (!Array.isArray(rows)) return res.status(500).json({ error: 'db-error' })

  const workspaces = rows.map(row => ({
    slug: row.slug,
    display_name: row.display_name,
    url: `https://${row.slug}.narraterx.ai`,
  }))

  res.setHeader('Cache-Control', 'no-store')
  return res.status(200).json({ workspaces })
}

export default withSentry(handler)
