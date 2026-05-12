import { withSentry } from '../_lib/sentry.js'
// GET /api/onboarding/capacity
//
// Response: { cap, used, remaining, full }
//
// Counts external (non-seed) active workspaces against the founding-owner cap.
// Used by the onboarding wizard's first screen to show "X spots left" or block
// further sign-ups when full.

import { FOUNDING_CAP, SEED_SLUGS } from '../_lib/onboardingValidation.js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY

async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'method-not-allowed' })
  }
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error('[capacity] Supabase env not configured')
    return res.status(500).json({ error: 'db-error' })
  }

  // PostgREST: select=slug filter status=eq.active. We count externals client-side
  // (the active workspaces table is small for the foreseeable future).
  let r
  try {
    r = await fetch(
      `${SUPABASE_URL}/rest/v1/workspaces?status=eq.active&select=slug`,
      { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } },
    )
  } catch (e) {
    console.error('[capacity] network error:', e?.message)
    return res.status(500).json({ error: 'db-error' })
  }
  if (!r.ok) {
    console.error(`[capacity] supabase ${r.status}`)
    return res.status(500).json({ error: 'db-error' })
  }
  const rows = await r.json().catch(() => null)
  if (!Array.isArray(rows)) return res.status(500).json({ error: 'db-error' })

  const used = rows.filter(row => !SEED_SLUGS.has(row.slug)).length
  const remaining = Math.max(0, FOUNDING_CAP - used)

  res.setHeader('Cache-Control', 'public, max-age=30')
  return res.status(200).json({
    cap: FOUNDING_CAP,
    used,
    remaining,
    full: remaining === 0,
  })
}

export default withSentry(handler)
