// GET /api/billing/plans
// Public — returns plan metadata including Stripe price IDs from env vars.
// No auth required (pricing data is public).

export const config = { runtime: 'nodejs' }

const PLANS = [
  {
    id: 'solo',
    name: 'Solo',
    price: 149,
    seats: 3,
    priceId: process.env.STRIPE_PRICE_SOLO || null,
    features: [
      '1–3 staff members',
      'AI interview capture',
      'Content drafting + approval workflow',
      'Email newsletter output',
      'Social media output (Buffer)',
      'Blog post generation',
    ],
  },
  {
    id: 'practice',
    name: 'Practice',
    price: 299,
    seats: 10,
    priceId: process.env.STRIPE_PRICE_PRACTICE || null,
    features: [
      '4–10 staff members',
      'Everything in Solo',
      'Cross-staff story synthesis',
      'Multi-location support',
      'Theme analysis across interviews',
      'Priority support',
    ],
  },
  {
    id: 'multi',
    name: 'Multi-location',
    price: 599,
    seats: 999,
    priceId: process.env.STRIPE_PRICE_MULTI || null,
    features: [
      'Unlimited staff members',
      'Everything in Practice',
      'Per-location content dashboard',
      'Aggregate analytics',
      'Custom AI voice per location',
      'Dedicated onboarding',
    ],
  },
]

async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'method-not-allowed' })
  }
  res.setHeader('Cache-Control', 'public, max-age=60')
  return res.status(200).json({ plans: PLANS })
}

export default handler
