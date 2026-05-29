// Shared Stripe price-ID → plan config mapping.
// Used by api/billing/checkout.js (to allow-list incoming priceIds before
// creating a Checkout Session) and api/billing/webhook.js (to apply the
// purchased plan after Stripe confirms the payment).

export function buildPricePlanMap() {
  const m = {}
  if (process.env.STRIPE_PRICE_SOLO)     m[process.env.STRIPE_PRICE_SOLO]     = { plan: 'solo',     seats: 3 }
  if (process.env.STRIPE_PRICE_PRACTICE) m[process.env.STRIPE_PRICE_PRACTICE] = { plan: 'practice', seats: 10 }
  if (process.env.STRIPE_PRICE_MULTI)    m[process.env.STRIPE_PRICE_MULTI]    = { plan: 'multi',    seats: 999 }
  return m
}
