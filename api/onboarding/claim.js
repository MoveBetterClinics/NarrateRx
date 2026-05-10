// POST /api/onboarding/claim
//
// Claims a new workspace for the signed-in user. Atomically (best-effort):
//   1. Validate slug + capacity + auth
//   2. Create Clerk Organization with the user as creator (auto-admin)
//   3. Insert workspaces row referencing the new org id
//   4. Set the user's publicMetadata.role = 'admin' so requireRole(['admin']) passes
//   5. Return the redirect URL (https://<slug>.narraterx.ai/settings/workspace)
//
// If step 3 fails after the org is created, we attempt to delete the org so the
// user can retry. If step 4 fails, we log but proceed — the workspace exists
// and the user can be promoted manually.
//
// Auth: Bearer Clerk JWT for any signed-in user. No org/role gate (this is
// where they CREATE their first org).

import { createClerkClient, verifyToken } from '@clerk/backend'
import { validateSlug, FOUNDING_CAP, SEED_SLUGS } from '../_lib/onboardingValidation.js'
import { OUTPUT_CHANNELS } from '../../src/lib/outputChannels.js'

const SUPABASE_URL  = process.env.SUPABASE_URL
const SUPABASE_KEY  = process.env.SUPABASE_SERVICE_KEY
const CLERK_SECRET  = process.env.CLERK_SECRET_KEY

let _clerk = null
function clerk() {
  if (!_clerk) _clerk = createClerkClient({ secretKey: CLERK_SECRET })
  return _clerk
}

function sb(path, init = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      ...init.headers,
    },
  })
}

async function authUserId(req) {
  const header = req.headers?.authorization || req.headers?.Authorization || ''
  const token  = header.startsWith('Bearer ') ? header.slice(7).trim() : null
  if (!token) return null
  try {
    const payload = await verifyToken(token, { secretKey: CLERK_SECRET })
    return payload?.sub || null
  } catch (e) {
    console.error('[claim] verifyToken failed:', e?.message)
    return null
  }
}

async function externalCount() {
  const r = await sb('workspaces?status=eq.active&select=slug')
  if (!r.ok) throw new Error(`capacity check failed: ${r.status}`)
  const rows = await r.json()
  if (!Array.isArray(rows)) throw new Error('capacity check returned non-array')
  return rows.filter(row => !SEED_SLUGS.has(row.slug)).length
}

function sanitizeStr(v, max = 2000) {
  if (typeof v !== 'string') return null
  const s = v.trim()
  if (!s) return null
  return s.slice(0, max)
}

function sanitizeUrl(v) {
  const s = sanitizeStr(v, 500)
  if (!s) return null
  if (!/^https?:\/\//i.test(s)) return `https://${s}`
  return s
}

function pickEnabledOutputs(arr) {
  if (!Array.isArray(arr)) return []
  const valid = new Set(Object.keys(OUTPUT_CHANNELS))
  const out = []
  for (const id of arr) {
    if (typeof id === 'string' && valid.has(id) && !out.includes(id)) out.push(id)
  }
  return out
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'method-not-allowed' })
  }
  if (!SUPABASE_URL || !SUPABASE_KEY || !CLERK_SECRET) {
    console.error('[claim] env not configured')
    return res.status(500).json({ error: 'server-misconfigured' })
  }

  const userId = await authUserId(req)
  if (!userId) return res.status(401).json({ error: 'unauthenticated' })

  const body = req.body || {}

  // Validate slug
  const slugCheck = validateSlug(body.slug)
  if (!slugCheck.ok) return res.status(400).json({ error: 'invalid-slug', reason: slugCheck.reason })
  const slug = slugCheck.slug

  // Validate display_name
  const display_name = sanitizeStr(body.display_name, 200)
  if (!display_name) return res.status(400).json({ error: 'missing-display-name' })

  // Validate enabled_outputs — must pick at least one
  const enabled_outputs = pickEnabledOutputs(body.enabled_outputs)
  if (enabled_outputs.length === 0) return res.status(400).json({ error: 'no-channels-selected' })

  // Capacity check (founding cap)
  let used
  try {
    used = await externalCount()
  } catch (e) {
    console.error('[claim] capacity check error:', e?.message)
    return res.status(500).json({ error: 'db-error' })
  }
  if (used >= FOUNDING_CAP) {
    return res.status(409).json({ error: 'founding-spots-full', cap: FOUNDING_CAP, used })
  }

  // Slug uniqueness pre-check (race-safe: insert below also enforces unique).
  let pre
  try {
    pre = await sb(`workspaces?slug=eq.${encodeURIComponent(slug)}&select=id&limit=1`)
  } catch (e) {
    console.error('[claim] slug pre-check network:', e?.message)
    return res.status(500).json({ error: 'db-error' })
  }
  if (!pre.ok) return res.status(500).json({ error: 'db-error' })
  const preRows = await pre.json().catch(() => null)
  if (Array.isArray(preRows) && preRows.length > 0) {
    return res.status(409).json({ error: 'slug-taken' })
  }

  // Optional fields — wizard-collected and forwarded as-is (sanitized).
  const website          = sanitizeUrl(body.website)
  const location         = sanitizeStr(body.location, 200)
  const clinic_context   = sanitizeStr(body.clinic_context, 4000)
  const audience_short   = sanitizeStr(body.audience_short, 400)
  const brand_voice      = sanitizeStr(body.brand_voice, 4000)
  let website_hostname = null
  if (website) {
    try { website_hostname = new URL(website).hostname } catch { /* noop */ }
  }

  // 2. Create Clerk Organization (creator becomes admin automatically).
  let org
  try {
    // Clerk org slug is auto-generated; we don't tie it to the workspace slug
    // because Clerk slugs live in a separate uniqueness namespace and we don't
    // need them to match (the workspace slug is what users see in the URL).
    org = await clerk().organizations.createOrganization({
      name: display_name,
      createdBy: userId,
    })
  } catch (e) {
    console.error('[claim] createOrganization failed:', e?.message)
    return res.status(500).json({ error: 'org-create-failed', detail: e?.message })
  }

  // 3. Insert workspace row.
  const insertBody = [{
    slug,
    display_name,
    app_name: display_name,
    website,
    website_hostname,
    location,
    clinic_context,
    audience_short,
    brand_voice,
    capabilities: {},
    enabled_outputs,
    clerk_org_id: org.id,
    is_founding: true,
    created_by_clerk_user_id: userId,
    status: 'active',
  }]

  let ins
  try {
    ins = await sb('workspaces', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify(insertBody),
    })
  } catch (e) {
    console.error('[claim] insert network:', e?.message)
    // Best-effort rollback of the Clerk org we just made.
    try { await clerk().organizations.deleteOrganization(org.id) } catch { /* swallow */ }
    return res.status(500).json({ error: 'db-error' })
  }

  if (!ins.ok) {
    const text = await ins.text().catch(() => '')
    console.error(`[claim] supabase insert ${ins.status}:`, text)
    try { await clerk().organizations.deleteOrganization(org.id) } catch { /* swallow */ }
    // 23505 = unique_violation — slug taken since pre-check (race)
    if (ins.status === 409 || /duplicate key|unique/i.test(text)) {
      return res.status(409).json({ error: 'slug-taken' })
    }
    return res.status(500).json({ error: 'db-error' })
  }

  const inserted = await ins.json().catch(() => null)
  const row = Array.isArray(inserted) ? inserted[0] : null
  if (!row) {
    try { await clerk().organizations.deleteOrganization(org.id) } catch { /* swallow */ }
    return res.status(500).json({ error: 'db-error' })
  }

  // 4. Promote the user to admin in Clerk publicMetadata. Best-effort.
  // Existing per-Clerk-app metadata is preserved; only `role` is overwritten.
  try {
    const user = await clerk().users.getUser(userId)
    const existing = user.publicMetadata || {}
    // If they already have a higher/equal role from another workspace, leave it.
    if (existing.role !== 'admin') {
      await clerk().users.updateUserMetadata(userId, {
        publicMetadata: { ...existing, role: 'admin' },
      })
    }
  } catch (e) {
    console.error('[claim] updateUserMetadata failed (continuing):', e?.message)
  }

  return res.status(200).json({
    workspace: {
      id: row.id,
      slug: row.slug,
      display_name: row.display_name,
      clerk_org_id: row.clerk_org_id,
    },
    redirect_url: `https://${slug}.narraterx.ai/settings/workspace`,
  })
}
