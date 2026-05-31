// api/_lib/clerkOrg.js
//
// Fetch ACTIVE Clerk organization members for a workspace's org. Used by the
// access-matrix reconciliation surface (find members with no staff row) and by
// the staff-reconcile endpoint (validate a claim target is really a member).
//
// Returns a flat list of { user_id, email, role, name }, paginated through all
// members. Non-fatal: on any failure returns [] so callers degrade gracefully
// (the matrix still renders; reconciliation just can't run).

const CLERK_API = 'https://api.clerk.com/v1'

export async function fetchClerkMembers(orgId) {
  const secret = process.env.CLERK_SECRET_KEY
  if (!orgId || !secret) return []

  const out = []
  const limit = 100
  let offset = 0
  // Defensive page cap (10 × 100 = 1000 members) so a bad total_count can never
  // spin an unbounded loop.
  for (let page = 0; page < 10; page++) {
    let res
    try {
      res = await fetch(
        `${CLERK_API}/organizations/${encodeURIComponent(orgId)}/memberships?limit=${limit}&offset=${offset}`,
        { headers: { Authorization: `Bearer ${secret}` } }
      )
    } catch (e) {
      console.error('[clerkOrg] memberships fetch threw:', e?.message)
      break
    }
    if (!res.ok) {
      console.error('[clerkOrg] memberships fetch failed:', res.status, await res.text().catch(() => ''))
      break
    }
    const body = await res.json().catch(() => null)
    const list = Array.isArray(body?.data) ? body.data : []
    for (const m of list) {
      const pud = m.public_user_data || {}
      const first = pud.first_name || ''
      const last = pud.last_name || ''
      out.push({
        user_id: pud.user_id || null,
        email: pud.identifier || null,
        role: m.role || null,
        name: [first, last].filter(Boolean).join(' ').trim() || pud.identifier || null,
      })
    }
    const total = typeof body?.total_count === 'number' ? body.total_count : out.length
    offset += limit
    if (list.length === 0 || offset >= total) break
  }
  return out
}
