import { withSentry } from '../_lib/sentry.js'
export const config = { runtime: 'nodejs' }
// POST /api/onboarding/claim
//
// Claims a new workspace for the signed-in user. Atomically (best-effort):
//   1. Validate slug + capacity + auth
//   2. Create Clerk Organization with the user as creator (auto-admin)
//   3. Insert workspaces row referencing the new org id
//   4. Set the user's publicMetadata.role = 'admin' so requireRole(['admin']) passes
//   5. Return the redirect URL (https://<slug>.narraterx.ai/onboard/brand-kit?welcome=1)
//
// If step 3 fails after the org is created, we attempt to delete the org so the
// user can retry. If step 4 fails, we log but proceed — the workspace exists
// and the user can be promoted manually.
//
// Auth: Bearer Clerk JWT for any signed-in user. No org/role gate (this is
// where they CREATE their first org).

import { createClerkClient, verifyToken } from '@clerk/backend'
import { validateSlug, FOUNDING_CAP, SEED_SLUGS } from '../_lib/onboardingValidation.js'
import { addProjectDomain, vercelDomainConfigured, VercelDomainError } from '../_lib/vercelDomains.js'
import { sendAdminNotification } from '../_lib/notifyAdmin.js'
import { OUTPUT_CHANNELS } from '../../src/lib/outputChannels.js'

const SUPABASE_URL  = process.env.SUPABASE_URL
const SUPABASE_KEY  = process.env.SUPABASE_SERVICE_KEY
const CLERK_SECRET  = process.env.CLERK_SECRET_KEY

let _clerk = null
function clerk() {
  if (!_clerk) _clerk = createClerkClient({ secretKey: CLERK_SECRET })
  return _clerk
}

// Fire-and-forget: fetch the NarrateRx mark from the deployed apex and
// upload it as the org logo. Replaces Clerk's default purple-building avatar.
// Never throws — log only. Skipped silently in dev when the apex isn't reachable.
async function uploadDefaultOrgLogo(orgId, userId) {
  try {
    const logoUrl = 'https://narraterx.ai/brand/narraterx-icon-512.png'
    const r = await fetch(logoUrl)
    if (!r.ok) {
      console.warn(`[claim] default-logo fetch ${r.status} for org=${orgId}`)
      return
    }
    const ab = await r.arrayBuffer()
    const file = new Blob([ab], { type: 'image/png' })
    await clerk().organizations.updateOrganizationLogo({
      organizationId:  orgId,
      file,
      uploaderUserId:  userId,
    })
  } catch (e) {
    console.warn(`[claim] default-logo upload failed for org=${orgId}: ${e?.message}`)
  }
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

// Mirrors the set in api/onboarding/my-workspaces.js. Public mailbox domains
// are not a tenant signal — a user signing up with gmail.com should never get
// matched against a tenant who happens to have a gmail URL on file.
const PUBLIC_EMAIL_DOMAINS = new Set([
  'gmail.com', 'googlemail.com',
  'yahoo.com', 'yahoo.co.uk', 'ymail.com',
  'hotmail.com', 'outlook.com', 'live.com', 'msn.com',
  'icloud.com', 'me.com', 'mac.com',
  'aol.com', 'protonmail.com', 'proton.me',
  'pm.me', 'gmx.com', 'zoho.com', 'fastmail.com',
])

function pickEnabledOutputs(arr) {
  if (!Array.isArray(arr)) return []
  const valid = new Set(Object.keys(OUTPUT_CHANNELS))
  const out = []
  for (const id of arr) {
    if (typeof id === 'string' && valid.has(id) && !out.includes(id)) out.push(id)
  }
  return out
}

async function handler(req, res) {
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

  // Capacity check (founding cap).
  //
  // ACCEPTED RACE (TOCTOU): this is read→check→insert with no DB-level guard,
  // so two POSTs landing in the same sub-second window while `used === cap - 1`
  // could both pass and create a (cap + 1)th founding workspace. Unlike slug
  // uniqueness — which has a DB unique constraint backstop on insert — the cap
  // has no serialization at the database.
  //
  // We accept this rather than fix it because the only robust DB-level guard
  // here is a Postgres advisory-lock RPC (count + insert in one transaction):
  // every write in this handler goes through PostgREST, where each REST call is
  // its own connection/transaction, so a lock cannot span the count and the
  // insert without a server-side function. That's a migration (function + GRANT
  // to service_role + apply-to-prod-before-merge) whose cost isn't justified at
  // current volume: FOUNDING_CAP is a lifetime cap of 10 external workspaces,
  // signups are rare, and the worst case is one extra founding tenant —
  // recoverable by flipping `is_founding`, with no data loss, corruption, or
  // cross-tenant exposure. Revisit (build the RPC) if signup concurrency rises.
  //
  // To keep the window observable: we log on every claim within one slot of the
  // cap, so the race actually firing leaves a trail in `vercel logs`.
  let used
  try {
    used = await externalCount()
  } catch (e) {
    console.error('[claim] capacity check error:', e?.message)
    return res.status(500).json({ error: 'db-error' })
  }
  if (used >= FOUNDING_CAP) {
    console.warn(`[claim] founding cap reached: used=${used} cap=${FOUNDING_CAP} — rejecting claim for slug=${slug} user=${userId}`)
    return res.status(409).json({ error: 'founding-spots-full', cap: FOUNDING_CAP, used })
  }
  if (used >= FOUNDING_CAP - 1) {
    // Within one slot of the cap — if a concurrent claim slips through the
    // TOCTOU window, this line appears twice for the same `used` value.
    console.warn(`[claim] founding cap near-full: used=${used} cap=${FOUNDING_CAP} — proceeding with slug=${slug} user=${userId} (TOCTOU window)`)
  }

  // Slug uniqueness pre-check (race-safe: insert below also enforces unique).
  let pre
  try {
    pre = await sb(`workspaces?slug=eq.${encodeURIComponent(slug)}&status=eq.active&select=id&limit=1`)
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
  const clinic_context   = sanitizeStr(body.clinic_context, 4000)
  const audience_short   = sanitizeStr(body.audience_short, 400)
  const brand_voice      = sanitizeStr(body.brand_voice, 4000)
  // capture_name — the founding clinician's display name for the Capture Companion.
  // Falls back to display_name so the seed row is never blank.
  const capture_name     = sanitizeStr(body.capture_name, 80) || display_name
  let website_hostname = null
  if (website) {
    try { website_hostname = new URL(website).hostname } catch { /* noop */ }
  }

  // Domain-match guard: defense-in-depth against a user signing up at /onboard
  // and accidentally creating a duplicate of an existing tenant's workspace
  // (e.g. alli@movebetter.co creating a second "Move Better" while the real
  // movebetter-people workspace already exists). The wizard surfaces this
  // earlier as a "your team already has a workspace" prompt, but we re-check
  // server-side so a stale tab or a hand-crafted POST can't bypass it.
  //
  // Match rule: the signed-in user's primary-email domain == an existing
  // active workspace's website_hostname (both lowercased, www. stripped).
  // Skipped when the user's domain is a public mailbox (gmail.com etc.) to
  // avoid false positives.
  try {
    const claimingUser = await clerk().users.getUser(userId)
    const primaryEmail = claimingUser?.emailAddresses?.find(e => e.id === claimingUser?.primaryEmailAddressId)
      || claimingUser?.emailAddresses?.[0]
    const addr = primaryEmail?.emailAddress || ''
    const at = addr.lastIndexOf('@')
    const userDomain = at > 0 ? addr.slice(at + 1).trim().toLowerCase().replace(/^www\./, '') : null
    if (userDomain && !PUBLIC_EMAIL_DOMAINS.has(userDomain)) {
      const existsRes = await sb(`workspaces?status=eq.active&select=slug,display_name,website_hostname`)
      if (existsRes.ok) {
        const rows = await existsRes.json().catch(() => null)
        if (Array.isArray(rows)) {
          const match = rows.find(r => {
            const h = (r.website_hostname || '').trim().toLowerCase().replace(/^www\./, '')
            return h && h === userDomain
          })
          if (match) {
            console.warn(`[claim] domain-already-claimed user=${userId} domain=${userDomain} existing=${match.slug}`)
            return res.status(409).json({
              error: 'domain-already-claimed',
              workspace: { slug: match.slug, display_name: match.display_name },
            })
          }
        }
      }
    }
  } catch (e) {
    // Non-fatal — if Clerk lookup throws, fall through to the normal path
    // rather than blocking a legitimate claim on an infra blip.
    console.error('[claim] domain-match check failed:', e?.message)
  }

  // Locations: array of { label, city, region }. First entry becomes the
  // primary; duplicates and empty cities are dropped. The umbrella
  // workspaces.location string is derived from the primary so prompts that
  // still read workspace.location keep rendering.
  const incomingLocations = Array.isArray(body.locations) ? body.locations : []
  const locations = []
  for (const raw of incomingLocations) {
    if (!raw || typeof raw !== 'object') continue
    const city = sanitizeStr(raw.city, 100)
    if (!city) continue
    const region = sanitizeStr(raw.region, 50)
    const label = sanitizeStr(raw.label, 100) || city
    locations.push({ label, city, region })
  }
  const primary = locations[0] || null
  const location = primary
    ? [primary.city, primary.region].filter(Boolean).join(', ')
    : null
  const location_keyword = primary?.city || null

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

  // 2a. Replace the generic Clerk org avatar with the NarrateRx mark.
  // Fire-and-forget — failure here shouldn't break the claim flow. Resolves
  // Clerk-dashboard-punchlist item #3 (new orgs got the purple building
  // icon). Once the user completes /onboard/brand-kit, their own logo can
  // replace this; until then the NarrateRx mark is a much better default.
  uploadDefaultOrgLogo(org.id, userId)

  // 3. Insert workspace row.
  const insertBody = [{
    slug,
    display_name,
    app_name: display_name,
    website,
    website_hostname,
    location,
    location_keyword,
    clinic_context,
    audience_short,
    brand_voice,
    capabilities: {},
    enabled_outputs,
    video_pipeline_enabled: true,
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

  // 3a. Insert workspace_locations rows. First entry is primary. If this fails
  // we don't roll back — the workspace is usable and the admin can fix this
  // from settings/locations. Logged so we can spot-fix.
  if (locations.length > 0) {
    const locInsert = locations.map((l, idx) => ({
      workspace_id: row.id,
      label: l.label,
      city: l.city,
      region: l.region,
      location_keyword: l.city,
      is_primary: idx === 0,
      position: idx,
    }))
    try {
      const lr = await sb('workspace_locations', {
        method: 'POST',
        body: JSON.stringify(locInsert),
      })
      if (!lr.ok) {
        const text = await lr.text().catch(() => '')
        console.error(`[claim] workspace_locations insert ${lr.status}:`, text)
      }
    } catch (e) {
      console.error('[claim] workspace_locations insert error:', e?.message)
    }
  }

  // 3b. Seed founding clinician row. Fire-and-forget — failure here doesn't block
  // the onboarding flow; the Capture Companion can create the row lazily on first
  // upload. Tied to the Clerk user_id so the capture endpoint can look them up.
  sb('staff', {
    method: 'POST',
    body: JSON.stringify({
      workspace_id: row.id,
      name: capture_name,
      user_id: userId,
      created_by_id: userId,
    }),
  }).catch(e => console.error('[claim] clinician seed failed:', e?.message))

  // 3.5. Register <slug>.narraterx.ai as a domain on the shared narraterx Vercel
  // project so per-domain cert issuance kicks off. Hard-fail with full rollback
  // if Vercel rejects: a workspace whose subdomain doesn't resolve is worse than
  // no workspace.
  //
  // Skipped (with a warning) when Vercel env vars aren't configured — keeps the
  // dev/local path working for engineers running this against a non-prod Vercel
  // project.
  const domainName = `${slug}.narraterx.ai`
  let domainRegistered = false
  if (vercelDomainConfigured()) {
    try {
      await addProjectDomain(domainName)
      domainRegistered = true
    } catch (e) {
      const detail = e instanceof VercelDomainError
        ? { status: e.status, code: e.code, message: e.message }
        : { message: e?.message }
      console.error('[claim] vercel domain add failed:', detail)
      // Roll back: workspace row + Clerk org. Order matters — DB first so any
      // racing /api/workspace/me lookups stop returning a half-provisioned row.
      try {
        await sb(`workspaces?id=eq.${encodeURIComponent(row.id)}`, { method: 'DELETE' })
      } catch (rollbackErr) {
        console.error('[claim] rollback delete workspace failed:', rollbackErr?.message)
      }
      try { await clerk().organizations.deleteOrganization(org.id) } catch { /* swallow */ }
      return res.status(502).json({ error: 'domain-registration-failed', code: detail.code })
    }
  } else {
    console.warn('[claim] VERCEL_TOKEN/VERCEL_PROJECT_ID not configured; skipping domain auto-register for', domainName)
  }

  // 4. Promote the user to admin in Clerk publicMetadata. Best-effort.
  // Existing per-Clerk-app metadata is preserved; only `role` is overwritten.
  let claimingUser = null
  try {
    claimingUser = await clerk().users.getUser(userId)
    const existing = claimingUser.publicMetadata || {}
    // If they already have a higher/equal role from another workspace, leave it.
    if (existing.role !== 'admin') {
      await clerk().users.updateUserMetadata(userId, {
        publicMetadata: { ...existing, role: 'admin' },
      })
    }
  } catch (e) {
    console.error('[claim] updateUserMetadata failed (continuing):', e?.message)
  }

  // 5. Notify the founder that someone signed up. Best-effort, fire-and-forget.
  try {
    const email = claimingUser?.emailAddresses?.find(
      e => e.id === claimingUser?.primaryEmailAddressId
    )?.emailAddress
      || claimingUser?.emailAddresses?.[0]?.emailAddress
      || '(unknown)'
    const fullName = [claimingUser?.firstName, claimingUser?.lastName].filter(Boolean).join(' ').trim()
    const who = fullName ? `${fullName} <${email}>` : email
    const lines = [
      `New NarrateRx signup: ${display_name} (${slug})`,
      '',
      `User:        ${who}`,
      `Workspace:   ${display_name}`,
      `Slug:        ${slug}`,
      `Subdomain:   https://${slug}.narraterx.ai`,
      website  ? `Website:     ${website}`  : null,
      locations.length > 0
        ? `Location${locations.length > 1 ? 's' : ''}:   ${locations.map(l => [l.city, l.region].filter(Boolean).join(', ')).join(' · ')}`
        : null,
      `Channels:    ${enabled_outputs.join(', ')}`,
      `Founding:    yes`,
      '',
      audience_short ? `Audience: ${audience_short}` : null,
      brand_voice    ? `Voice:    ${brand_voice}`    : null,
      clinic_context ? `Context:  ${clinic_context}` : null,
    ].filter(v => v !== null)
    // Don't await — keeps response latency low. Vercel Fluid Compute keeps the
    // function alive long enough for fire-and-forget tasks to complete.
    sendAdminNotification({
      subject: `[NarrateRx] New signup: ${display_name} (${slug})`,
      text: lines.join('\n'),
    }).catch(e => console.error('[claim] notifyAdmin error:', e?.message))
  } catch (e) {
    console.error('[claim] notifyAdmin setup failed (continuing):', e?.message)
  }

  return res.status(200).json({
    workspace: {
      id: row.id,
      slug: row.slug,
      display_name: row.display_name,
      clerk_org_id: row.clerk_org_id,
    },
    domain_registered: domainRegistered,
    // Final wizard step lives on the new subdomain because the brand-kit
    // upload endpoints resolve workspace via Host header — they can't run on
    // the apex onboarding page. /onboard/brand-kit advances to /?welcome=1
    // (Dashboard + welcome banner + getting-started checklist) once the user
    // hits "Looks good — continue" or "Skip for now".
    redirect_url: `https://${slug}.narraterx.ai/onboard/brand-kit?welcome=1`,
  })
}

export default withSentry(handler)
