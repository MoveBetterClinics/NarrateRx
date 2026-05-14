// POST /api/billing/checkout
// Creates a Stripe Checkout Session for a plan upgrade.
// Body: { priceId: string }
// Returns: { url: string }
//
// Node runtime — uses req/res handler shape, imports @clerk/backend via auth.js.

import { withSentry } from '../_lib/sentry.js'
import { workspaceContext } from '../_lib/workspaceContext.js'
import { requireRole } from '../_lib/auth.js'

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
    console.error('[billing/checkout] STRIPE_SECRET_KEY not set')
    return res.status(500).json({ error: 'billing-not-configured' })
  }

  const auth = await requireRole(req, ['admin'])
  if (!auth.ok) {
    return res.status(auth.reason === 'forbidden' ? 403 : 401).json({ error: auth.reason })
  }

  const ws = await workspaceContext(req)
  if (!ws) return res.status(404).json({ error: 'no-workspace-context' })

  const { priceId } = req.body || {}
  if (!priceId) return res.status(400).json({ error: 'priceId-required' })

  // Build success/cancel URLs from the request host.
  const host = req.headers['x-forwarded-host'] || req.headers.host || 'narraterx.ai'
  const protocol = process.env.VERCEL_ENV === 'production' ? 'https' : 'https'
  const base = `${protocol}://${host}`

  try {
    const sessionParams = {
      mode: 'subscription',
      'line_items[0][price]': priceId,
      'line_items[0][quantity]': '1',
      success_url: `${base}/settings/workspace?billing=success`,
      cancel_url: `${base}/settings/workspace?billing=cancelled`,
      'metadata[workspace_id]': ws.id,
      'subscription_data[metadata][workspace_id]': ws.id,
    }

    // Pre-populate email if we have it from the workspace or auth user.
    if (ws.owner_email) {
      sessionParams.customer_email = ws.owner_email
    }

    // If workspace already has a Stripe customer, attach to it instead of
    // creating a new one — prevents duplicate customers on re-subscribe.
    if (ws.stripe_customer_id) {
      sessionParams.customer = ws.stripe_customer_id
      // Remove customer_email if using existing customer — Stripe rejects both.
      delete sessionParams.customer_email
    }

    const session = await stripePost('/checkout/sessions', sessionParams)
    if (session.error) {
      console.error('[billing/checkout] Stripe error:', session.error)
      return res.status(500).json({ error: 'stripe-error', detail: session.error.message })
    }

    return res.status(200).json({ url: session.url })
  } catch (e) {
    console.error('[billing/checkout] unexpected error:', e?.message)
    return res.status(500).json({ error: 'checkout-failed' })
  }
}

export default withSentry(handler)
