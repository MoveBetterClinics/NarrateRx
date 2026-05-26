// POST /api/billing/webhook
// Handles Stripe webhook events.
//
// Stripe hits this endpoint directly — NOT via user session. No workspaceContext.
// Uses workspace_id from the Stripe event metadata to find the workspace.
//
// Events handled:
//   checkout.session.completed        → activate subscription
//   customer.subscription.updated     → update plan/price
//   customer.subscription.deleted     → revert to trial
//   invoice.payment_failed            → mark plan as past_due (blocks paid features)
//   invoice.paid                      → clear past_due, restore active plan
//
// Signature verification uses STRIPE_WEBHOOK_SECRET (HMAC-SHA256).
// In dev (no secret set), verification is skipped with a warning.
//
// IMPORTANT: Stripe sends the raw body for signature verification, so we
// must read the raw buffer before any JSON parsing. Vercel's bodyParser
// is disabled via the config export below.

import { createHmac, timingSafeEqual } from 'node:crypto'

export const config = {
  runtime: 'nodejs',
  api: { bodyParser: false },
}

const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET
const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY

// Price ID → plan config mapping (from env vars).
function buildPricePlanMap() {
  const m = {}
  if (process.env.STRIPE_PRICE_SOLO)     m[process.env.STRIPE_PRICE_SOLO]     = { plan: 'solo',     seats: 3 }
  if (process.env.STRIPE_PRICE_PRACTICE) m[process.env.STRIPE_PRICE_PRACTICE] = { plan: 'practice', seats: 10 }
  if (process.env.STRIPE_PRICE_MULTI)    m[process.env.STRIPE_PRICE_MULTI]    = { plan: 'multi',    seats: 999 }
  return m
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

async function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    req.on('data', (chunk) => chunks.push(chunk))
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

// Stripe signature verification — manual HMAC-SHA256.
// https://stripe.com/docs/webhooks/signatures
function verifyStripeSignature(rawBody, sigHeader, secret) {
  if (!sigHeader) return false
  const parts = {}
  for (const part of sigHeader.split(',')) {
    const [k, v] = part.split('=')
    if (k && v) parts[k] = v
  }
  const timestamp = parts.t
  const sig = parts.v1
  if (!timestamp || !sig) return false

  // Reject events outside Stripe's 5-minute tolerance window to prevent
  // replay attacks (captured webhooks could otherwise be replayed indefinitely
  // to e.g. re-activate a cancelled subscription).
  const ts = parseInt(timestamp, 10)
  if (!Number.isFinite(ts) || Math.abs(Date.now() / 1000 - ts) > 300) return false

  const payload = `${timestamp}.${rawBody}`
  const expected = createHmac('sha256', secret).update(payload, 'utf8').digest('hex')

  try {
    return timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(sig, 'hex'))
  } catch {
    return false
  }
}

async function updateWorkspace(workspaceId, patch) {
  const r = await sb(
    `workspaces?id=eq.${encodeURIComponent(workspaceId)}`,
    {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify(patch),
    },
  )
  if (!r.ok) {
    const text = await r.text().catch(() => '')
    console.error(`[billing/webhook] workspace patch failed (${r.status}):`, text)
    return false
  }
  return true
}

async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'method-not-allowed' })
  }

  const rawBody = await readRawBody(req)
  const rawBodyStr = rawBody.toString('utf8')
  const sigHeader = req.headers['stripe-signature']

  // Verify signature when secret is configured.
  if (STRIPE_WEBHOOK_SECRET) {
    if (!verifyStripeSignature(rawBodyStr, sigHeader, STRIPE_WEBHOOK_SECRET)) {
      console.error('[billing/webhook] signature verification failed')
      return res.status(400).json({ error: 'invalid-signature' })
    }
  } else if (process.env.VERCEL_ENV === 'production') {
    // Fail closed in production — never accept unsigned webhooks here.
    console.error('[billing/webhook] STRIPE_WEBHOOK_SECRET not configured in production — refusing request')
    return res.status(503).json({ error: 'webhook-secret-not-configured' })
  } else {
    console.warn('[billing/webhook] STRIPE_WEBHOOK_SECRET not set — skipping signature verification (dev only)')
  }

  let event
  try {
    event = JSON.parse(rawBodyStr)
  } catch (e) {
    console.error('[billing/webhook] JSON parse error:', e?.message)
    return res.status(400).json({ error: 'invalid-json' })
  }

  const PRICE_PLAN_MAP = buildPricePlanMap()

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object
        const workspaceId = session.metadata?.workspace_id
        if (!workspaceId) {
          console.error('[billing/webhook] checkout.session.completed: no workspace_id in metadata')
          break
        }
        const customerId = session.customer
        const subscriptionId = session.subscription

        // Fetch the subscription to get the price ID.
        let priceId = null
        let planConfig = null
        if (subscriptionId) {
          try {
            const subRes = await fetch(`https://api.stripe.com/v1/subscriptions/${subscriptionId}`, {
              headers: { Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}` },
            })
            const sub = await subRes.json()
            priceId = sub?.items?.data?.[0]?.price?.id || null
            planConfig = priceId ? PRICE_PLAN_MAP[priceId] : null
          } catch (e) {
            console.error('[billing/webhook] failed to fetch subscription:', e?.message)
          }
        }

        const patch = {
          stripe_customer_id: customerId || null,
          stripe_subscription_id: subscriptionId || null,
          stripe_price_id: priceId,
          plan: planConfig?.plan || 'solo',
          plan_seats: planConfig?.seats || 3,
          trial_ends_at: null, // Clear trial on activation
        }
        await updateWorkspace(workspaceId, patch)
        console.info(`[billing/webhook] activated workspace ${workspaceId} on plan ${patch.plan}`)
        break
      }

      case 'customer.subscription.updated': {
        const sub = event.data.object
        const workspaceId = sub.metadata?.workspace_id
        if (!workspaceId) {
          console.error('[billing/webhook] customer.subscription.updated: no workspace_id in metadata')
          break
        }
        const priceId = sub?.items?.data?.[0]?.price?.id || null
        const planConfig = priceId ? PRICE_PLAN_MAP[priceId] : null
        if (planConfig) {
          await updateWorkspace(workspaceId, {
            stripe_price_id: priceId,
            plan: planConfig.plan,
            plan_seats: planConfig.seats,
          })
          console.info(`[billing/webhook] updated workspace ${workspaceId} to plan ${planConfig.plan}`)
        } else {
          console.warn(`[billing/webhook] subscription.updated: unknown priceId ${priceId} for workspace ${workspaceId}`)
        }
        break
      }

      case 'customer.subscription.deleted': {
        const sub = event.data.object
        const workspaceId = sub.metadata?.workspace_id
        if (!workspaceId) {
          console.error('[billing/webhook] customer.subscription.deleted: no workspace_id in metadata')
          break
        }
        // Revert to trial with 14-day window.
        const trialEndsAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString()
        await updateWorkspace(workspaceId, {
          plan: 'trial',
          plan_seats: 3,
          stripe_subscription_id: null,
          stripe_price_id: null,
          trial_ends_at: trialEndsAt,
        })
        console.info(`[billing/webhook] workspace ${workspaceId} subscription cancelled — reverted to trial`)
        break
      }

      case 'invoice.payment_failed': {
        // Card declined / payment method expired. Mark the workspace as past_due
        // so paid features are blocked until payment is resolved. Stripe will
        // send invoice.paid when the customer updates their card and retries.
        const invoice = event.data.object
        const workspaceId = invoice.subscription_details?.metadata?.workspace_id
          ?? invoice.metadata?.workspace_id
        if (!workspaceId) {
          // Try to look up workspace by customer ID as fallback.
          const customerId = invoice.customer
          if (customerId) {
            const r = await sb(`workspaces?stripe_customer_id=eq.${encodeURIComponent(customerId)}&select=id&limit=1`)
            if (r.ok) {
              const rows = await r.json()
              if (rows[0]?.id) {
                await updateWorkspace(rows[0].id, { plan: 'past_due' })
                console.warn(`[billing/webhook] invoice.payment_failed: workspace ${rows[0].id} marked past_due`)
              }
            }
          } else {
            console.error('[billing/webhook] invoice.payment_failed: could not resolve workspace_id')
          }
          break
        }
        await updateWorkspace(workspaceId, { plan: 'past_due' })
        console.warn(`[billing/webhook] invoice.payment_failed: workspace ${workspaceId} marked past_due`)
        break
      }

      case 'invoice.paid': {
        // Successful payment after a past_due state (or normal renewal). Restore
        // the plan from the subscription's price ID.
        const invoice = event.data.object
        const customerId = invoice.customer || null
        let workspaceId = invoice.subscription_details?.metadata?.workspace_id
          ?? invoice.metadata?.workspace_id
          ?? null

        if (!workspaceId && customerId) {
          // Fallback: look up by customer id (same pattern as invoice.payment_failed).
          const r = await sb(`workspaces?stripe_customer_id=eq.${encodeURIComponent(customerId)}&select=id&limit=1`)
          if (r.ok) {
            const rows = await r.json()
            workspaceId = rows[0]?.id || null
          }
        }

        if (!workspaceId) {
          console.error(`[billing/webhook] invoice.paid: could not resolve workspace_id (customer=${customerId})`)
          break
        }

        const subscriptionId = invoice.subscription
        let priceId = null
        let planConfig = null
        if (subscriptionId) {
          try {
            const subRes = await fetch(`https://api.stripe.com/v1/subscriptions/${subscriptionId}`, {
              headers: { Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}` },
            })
            const sub = await subRes.json()
            priceId = sub?.items?.data?.[0]?.price?.id || null
            planConfig = priceId ? PRICE_PLAN_MAP[priceId] : null
          } catch (e) {
            console.error('[billing/webhook] invoice.paid: failed to fetch subscription:', e?.message)
          }
        }

        if (planConfig) {
          await updateWorkspace(workspaceId, {
            plan:       planConfig.plan,
            plan_seats: planConfig.seats,
            stripe_price_id: priceId,
          })
          console.info(`[billing/webhook] invoice.paid: workspace ${workspaceId} restored to ${planConfig.plan}`)
        } else {
          // Unknown priceId (env-var mismatch, mid-migration price, or a duplicate
          // subscription). Unblock the workspace at the lowest paid tier rather
          // than leaving it stuck on past_due, and warn loudly so this is fixed.
          console.warn(`[billing/webhook] invoice.paid: unknown priceId ${priceId} for workspace ${workspaceId} (customer=${customerId}) — falling back to plan='solo'`)
          await updateWorkspace(workspaceId, {
            plan: 'solo',
            plan_seats: 3,
          })
        }
        break
      }

      default:
        // Unhandled event types — acknowledge and move on.
        break
    }
  } catch (e) {
    console.error('[billing/webhook] handler error:', e?.message)
    return res.status(500).json({ error: 'handler-error' })
  }

  // Always return 200 to acknowledge receipt — Stripe retries on non-2xx.
  return res.status(200).json({ received: true })
}

export default handler
