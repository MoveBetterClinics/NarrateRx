// POST /api/staff/ensure-self  { name?: string }
//
// Idempotently ensures the calling user has a "Self" staff/clinician row in the
// current workspace, bound to their Clerk user_id. Returns the row.
//
// Why this exists: a freshly INVITED member (e.g. a clinician who just accepted
// an org invite) has no clinicians row until they start their first interview —
// the row was historically created lazily inside api/db/clinicians.js's POST.
// That left invited staff with no "My staff profile" entry in the avatar menu
// (gated on selfStaffId) and an empty Activity/Voice/Settings profile until
// they happened to record something. This endpoint lets the app provision the
// row on workspace load so the profile exists from day one.
//
// Resolution order (mirrors the find-or-create logic in api/db/clinicians.js):
//   1. Row already bound to this user_id in this workspace → return it.
//   2. A proxy row (user_id null) whose name matches → claim it (set user_id).
//   3. Otherwise create a new row bound to user_id.
//
// Idempotent: safe to call on every load. Scoped by workspace_id + user_id, so
// it can never touch another tenant's data or another user's row.
//
// permission_tier is intentionally left null on create — /api/workspace/me
// resolves a null tier to the 'clinician' default template for non-admins (and
// 'owner' for org admins via the isOrgAdmin short-circuit), so provisioning the
// row never changes the caller's authorization.

export const config = { runtime: 'nodejs' }

import { createClerkClient } from '@clerk/backend'
import { requireRole } from '../_lib/auth.js'
import { workspaceContext } from '../_lib/workspaceContext.js'
import { enforceLimit } from '../_lib/ratelimit.js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY
const CLERK_SECRET = process.env.CLERK_SECRET_KEY

let _clerk = null
function clerk() {
  if (!_clerk) _clerk = createClerkClient({ secretKey: CLERK_SECRET })
  return _clerk
}

const CLINICIAN_FIELDS = 'id,workspace_id,name,user_id,permission_tier,created_at'

function sb(path, init = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
      ...init.headers,
    },
  })
}

// Derive a sensible display label for a freshly-invited user who may not have
// set a name yet. Falls back through full name → first name → email local part
// → a generic label so the row is never created with an empty name.
function deriveName(user) {
  const full = [user?.firstName, user?.lastName].filter(Boolean).join(' ').trim()
  if (full) return full
  const primaryId = user?.primaryEmailAddressId
  const primary = user?.emailAddresses?.find(e => e.id === primaryId) || user?.emailAddresses?.[0]
  const addr = primary?.emailAddress || ''
  const local = addr.includes('@') ? addr.slice(0, addr.indexOf('@')) : addr
  if (local) return local
  return 'Staff member'
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  if (!SUPABASE_URL || !SUPABASE_KEY || !CLERK_SECRET) {
    console.error('[clinicians/ensure-self] env not configured')
    return res.status(500).json({ error: 'server-misconfigured' })
  }
  // 'generic' bucket, not 'media' — this is an infrequent provisioning call on
  // workspace load; sharing the media-upload budget could starve it during a
  // burst upload and silently re-strand the user without a staff profile.
  if (!(await enforceLimit(req, res, 'generic'))) return

  const auth = await requireRole(req, null)
  if (!auth.ok) return res.status(auth.reason === 'forbidden' ? 403 : 401).json({ error: auth.reason })

  const ws = await workspaceContext(req)
  if (!ws) return res.status(400).json({ error: 'Workspace not resolved' })

  const wsFilter = `workspace_id=eq.${ws.id}`
  const userId = auth.userId

  // 1. Already provisioned? Return the existing Self row.
  const byUserRes = await sb(`staff?${wsFilter}&user_id=eq.${encodeURIComponent(userId)}&select=${CLINICIAN_FIELDS}`)
  if (!byUserRes.ok) {
    const body = await byUserRes.text().catch(() => '')
    console.error(`[clinicians/ensure-self] lookup ${byUserRes.status}: ${body.slice(0, 500)}`)
    return res.status(500).json({ error: 'Database error' })
  }
  const byUser = await byUserRes.json()
  if (byUser.length > 0) return res.status(200).json({ clinician: byUser[0], created: false })

  // Resolve a display name. Trust the client-supplied label when present (it's
  // only a label, never identity), otherwise derive from the Clerk profile so
  // nameless freshly-invited users still get a usable row.
  let name = (req.body?.name || '').trim()
  let createdByEmail = null
  try {
    const user = await clerk().users.getUser(userId)
    if (!name) name = deriveName(user)
    const primaryId = user?.primaryEmailAddressId
    const primary = user?.emailAddresses?.find(e => e.id === primaryId) || user?.emailAddresses?.[0]
    createdByEmail = primary?.emailAddress || null
  } catch (e) {
    console.error('[clinicians/ensure-self] clerk getUser failed:', e?.message)
    if (!name) name = 'Staff member'
  }
  // Cap the label — it's a free-text display string and the body is caller-
  // supplied. Keeps the ilike query and the insert bounded.
  name = name.slice(0, 200)

  // 2. Claim a matching proxy row (admin pre-recorded this person; user_id null).
  const byNameRes = await sb(`staff?${wsFilter}&user_id=is.null&name=ilike.${encodeURIComponent(name)}&select=${CLINICIAN_FIELDS}`)
  if (byNameRes.ok) {
    const byName = await byNameRes.json()
    if (byName.length > 0) {
      // Conditional claim: only update if the row is STILL unclaimed
      // (user_id is null). Without this filter two users racing on the same
      // proxy name could both pass the SELECT and the second PATCH would steal
      // the first's row. If the conditional PATCH affects zero rows, someone
      // else claimed it first — fall through to create our own row.
      const claimRes = await sb(`staff?id=eq.${byName[0].id}&user_id=is.null&${wsFilter}&select=${CLINICIAN_FIELDS}`, {
        method: 'PATCH',
        body: JSON.stringify({ user_id: userId, updated_at: new Date().toISOString() }),
      })
      if (claimRes.ok) {
        const claimed = await claimRes.json()
        if (Array.isArray(claimed) && claimed.length > 0) {
          return res.status(200).json({ clinician: claimed[0], created: false })
        }
        // Zero rows updated — lost the race; fall through to create.
      } else {
        // Claim failed — fall through to create rather than strand the user.
        console.warn(`[clinicians/ensure-self] proxy claim failed for ${byName[0].id}`)
      }
    }
  }

  // 3. Create a new Self row.
  const createRes = await sb(`staff?select=${CLINICIAN_FIELDS}`, {
    method: 'POST',
    body: JSON.stringify({
      workspace_id: ws.id,
      name,
      user_id: userId,
      created_by_id: userId,
      created_by_email: createdByEmail,
    }),
  })
  if (!createRes.ok) {
    const body = await createRes.text().catch(() => '')
    console.error(`[clinicians/ensure-self] create ${createRes.status}: ${body.slice(0, 500)}`)
    return res.status(500).json({ error: 'Database error' })
  }
  const created = await createRes.json()
  return res.status(201).json({ clinician: created[0], created: true })
}
