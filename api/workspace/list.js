import { withSentry } from '../_lib/sentry.js'
export const config = { runtime: 'nodejs' }
// GET /api/workspace/list
//
// Returns all active workspaces the signed-in user belongs to (via Clerk org
// membership). Used by the workspace switcher in the nav header.
//
// Response: [{ id, slug, display_name, clerk_org_id }]
//
// Auth: Bearer Clerk JWT for any signed-in user. No org/role gate — the user
//       identity alone is sufficient because we only return workspaces they're
//       already a member of (Clerk membership is the authorization check).

import { createClerkClient, verifyToken } from '@clerk/backend'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY
const CLERK_SECRET = process.env.CLERK_SECRET_KEY

let _clerk = null
function clerk() {
  if (!_clerk) _clerk = createClerkClient({ secretKey: CLERK_SECRET })
  return _clerk
}

async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'method-not-allowed' })
  }
  if (!SUPABASE_URL || !SUPABASE_KEY || !CLERK_SECRET) {
    console.error('[workspace/list] env not configured')
    return res.status(500).json({ error: 'server-misconfigured' })
  }

  const header = req.headers?.authorization || req.headers?.Authorization || ''
  const token  = header.startsWith('Bearer ') ? header.slice(7).trim() : null
  if (!token) return res.status(401).json({ error: 'unauthenticated' })

  let userId
  try {
    const payload = await verifyToken(token, { secretKey: CLERK_SECRET })
    userId = payload?.sub || null
  } catch (e) {
    console.error('[workspace/list] verifyToken failed:', e?.message)
    return res.status(401).json({ error: 'invalid-token' })
  }
  if (!userId) return res.status(401).json({ error: 'unauthenticated' })

  let orgIds = []
  try {
    const memberships = await clerk().users.getOrganizationMembershipList({ userId, limit: 100 })
    const data = Array.isArray(memberships?.data) ? memberships.data : memberships
    orgIds = (data || []).map(m => m?.organization?.id).filter(Boolean)
  } catch (e) {
    console.error('[workspace/list] clerk membership list failed:', e?.message)
    return res.status(500).json({ error: 'clerk-error' })
  }

  if (orgIds.length === 0) {
    res.setHeader('Cache-Control', 'no-store')
    return res.status(200).json([])
  }

  const inList = orgIds.map(id => `"${id}"`).join(',')
  const url = `${SUPABASE_URL}/rest/v1/workspaces?status=eq.active&clerk_org_id=in.(${encodeURIComponent(inList)})&select=id,slug,display_name,clerk_org_id&order=display_name.asc`

  let r
  try {
    r = await fetch(url, {
      headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
    })
  } catch (e) {
    console.error('[workspace/list] supabase network:', e?.message)
    return res.status(500).json({ error: 'db-error' })
  }
  if (!r.ok) {
    console.error(`[workspace/list] supabase ${r.status}`)
    return res.status(500).json({ error: 'db-error' })
  }

  const rows = await r.json().catch(() => null)
  if (!Array.isArray(rows)) return res.status(500).json({ error: 'db-error' })

  res.setHeader('Cache-Control', 'no-store')
  return res.status(200).json(rows)
}

export default withSentry(handler)
