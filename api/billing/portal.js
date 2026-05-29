// POST /api/billing/portal
// Creates a Stripe Billing Portal session for the workspace.
// Returns: { url: string }
//
// If the workspace has no stripe_customer_id yet, falls back to checkout.
// Node runtime.

import { withSentry } from '../_lib/sentry.js'
import { workspaceContext } from '../_lib/workspaceContext.js'
import { requireRole, requireCapability } from '../_lib/auth.js'
import { CAP_BILLING_VIEW } from '../_lib/capabilities.js'

export const config = { runtime: 'nodejs' }

const STRIPE_SECRET = process.env.STRIPE_SECRET_KEY
const STRIPE_API = 'https://api.stripe.com/v1'

async function stripePost(path, params) {
  const body = new URLSearchParams(params)
  const r = await fetch(`${STRIPE_API}${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${STRIPE_SECRET}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  })
  return r.json()
}

async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'method-not-allowed' })
  }

  if (!STRIPE_SECRET) {
    console.error('[billing/portal] STRIPE_SECRET_KEY not set')
    return res.status(500).json({ error: 'billing-not-configured' })
  }

  const ws = await workspaceContext(req)
  if (!ws) return res.status(404).json({ error: 'no-workspace-context' })

  const auth = await requireRole(req, ['admin'], { orgId: ws.clerk_org_id })
  if (!auth.ok) {
    return res.status(auth.reason === 'forbidden' ? 403 : 401).json({ error: auth.reason })
  }

  // Phase 4 PR 3: capability gate on top of the legacy role gate. Opt-in
  // per-user (see requireCapability comments).
  const capAuth = await requireCapability(req, ws, [CAP_BILLING_VIEW])
  if (!capAuth.ok) {
    return res.status(403).json({ error: capAuth.reason, missing: capAuth.missing })
  }

  const host = req.headers['x-forwarded-host'] || req.headers.host || 'narraterx.ai'
  const base = `https://${host}`
  const returnUrl = `${base}/settings/workspace/billing`

  // No customer yet — no portal to show. Tell client to go to checkout instead.
  if (!ws.stripe_customer_id) {
    return res.status(200).json({ redirect_to_checkout: true })
  }

  try {
    const session = await stripePost('/billing_portal/sessions', {
      customer: ws.stripe_customer_id,
      return_url: returnUrl,
    })
    if (session.error) {
      console.error('[billing/portal] Stripe error:', session.error)
      return res.status(500).json({ error: 'stripe-error', detail: session.error.message })
    }

    return res.status(200).json({ url: session.url })
  } catch (e) {
    console.error('[billing/portal] unexpected error:', e?.message)
    return res.status(500).json({ error: 'portal-failed' })
  }
}

export default withSentry(handler)
