import { withSentry } from '../_lib/sentry.js'
export const config = { runtime: 'nodejs' }
// POST /api/onboarding/check-slug
//
// Body: { slug }
// Response: { available: bool, reason?: 'required'|'too-short'|'too-long'|'invalid-format'|'reserved'|'taken'|'db-error', slug?: string }
//
// Public endpoint — used by the onboarding wizard for live availability feedback
// while the user types. Returns 200 even on validation/taken — the `available`
// field is the decision; reasons are advisory.

import { validateSlug } from '../_lib/onboardingValidation.js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY

async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ available: false, reason: 'method-not-allowed' })
  }

  const body = req.body || {}
  const v = validateSlug(body.slug)
  if (!v.ok) return res.status(200).json({ available: false, reason: v.reason })

  if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error('[check-slug] Supabase env not configured')
    return res.status(200).json({ available: false, reason: 'db-error' })
  }

  let r
  try {
    r = await fetch(
      `${SUPABASE_URL}/rest/v1/workspaces?slug=eq.${encodeURIComponent(v.slug)}&status=eq.active&select=id&limit=1`,
      { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } },
    )
  } catch (e) {
    console.error('[check-slug] network error:', e?.message)
    return res.status(200).json({ available: false, reason: 'db-error' })
  }
  if (!r.ok) {
    console.error(`[check-slug] supabase ${r.status}`)
    return res.status(200).json({ available: false, reason: 'db-error' })
  }
  const rows = await r.json().catch(() => null)
  if (!Array.isArray(rows)) return res.status(200).json({ available: false, reason: 'db-error' })

  if (rows.length > 0) return res.status(200).json({ available: false, reason: 'taken', slug: v.slug })
  return res.status(200).json({ available: true, slug: v.slug })
}

export default withSentry(handler)
