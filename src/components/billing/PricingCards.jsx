import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '@clerk/react'
import { Check, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'

// Displays the three NarrateRx subscription plans side-by-side (or stacked on
// mobile). Highlights the active plan and wires Upgrade / Manage buttons to
// the billing API endpoints.
//
// Props:
//   currentPlan  — string from workspace.plan ('trial'|'solo'|'practice'|'multi')
//   onSuccess    — optional callback after successful redirect (rarely needed)

export default function PricingCards({ currentPlan = 'trial' }) {
  const { getToken } = useAuth()
  const [plans, setPlans] = useState([])
  const [loading, setLoading] = useState(true)
  const [actionLoading, setActionLoading] = useState(null) // plan id in flight
  const [error, setError] = useState(null)

  useEffect(() => {
    fetch('/api/billing/plans')
      .then((r) => r.ok ? r.json() : null)
      .then((d) => { if (d?.plans) setPlans(d.plans) })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  async function handleUpgrade(priceId, planId) {
    if (!priceId) {
      setError('This plan is not yet available for purchase.')
      return
    }
    setError(null)
    setActionLoading(planId)
    try {
      const token = await getToken()
      const r = await fetch('/api/billing/checkout', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ priceId }),
      })
      const data = await r.json()
      if (!r.ok || !data.url) {
        setError(data.detail || data.error || 'checkout-failed')
        return
      }
      window.location.assign(data.url)
    } catch {
      setError('Network error — please try again.')
    } finally {
      setActionLoading(null)
    }
  }

  async function handleManage() {
    setError(null)
    setActionLoading('manage')
    try {
      const token = await getToken()
      const r = await fetch('/api/billing/portal', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      })
      const data = await r.json()
      if (!r.ok) {
        setError(data.error || 'portal-failed')
        return
      }
      if (data.redirect_to_checkout) {
        // No customer yet — redirect to plans section.
        setError(null)
        return
      }
      window.location.assign(data.url)
    } catch {
      setError('Network error — please try again.')
    } finally {
      setActionLoading(null)
    }
  }

  const PLAN_RANK = { trial: 0, solo: 1, practice: 2, multi: 3 }
  const currentRank = PLAN_RANK[currentPlan] ?? 0

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {error && (
        <p className="text-sm text-destructive">{error}</p>
      )}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {plans.map((plan) => {
          const isActive = currentPlan === plan.id
          const planRank = PLAN_RANK[plan.id] ?? 1
          const isUpgrade = planRank > currentRank
          const isDowngrade = planRank < currentRank
          const inFlight = actionLoading === plan.id
          const manageInFlight = actionLoading === 'manage'

          return (
            <div
              key={plan.id}
              className={`relative rounded-xl border p-6 flex flex-col gap-4 ${
                isActive
                  ? 'border-orange-500 bg-orange-50/50 dark:bg-orange-950/20 shadow-sm'
                  : 'border-border bg-card'
              }`}
            >
              {isActive && (
                <span className="absolute -top-3 left-1/2 -translate-x-1/2 inline-flex items-center gap-1 rounded-full bg-orange-500 px-3 py-0.5 text-2xs font-semibold text-white uppercase tracking-wide">
                  Current plan
                </span>
              )}

              <div>
                <h3 className="text-base font-semibold">{plan.name}</h3>
                <div className="mt-1 flex items-baseline gap-1">
                  <span className="text-3xl font-bold">${plan.price}</span>
                  <span className="text-sm text-muted-foreground">/month</span>
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  Up to {plan.seats === 999 ? 'unlimited' : plan.seats} staff members
                </p>
              </div>

              <ul className="flex-1 space-y-2">
                {plan.features.map((feature) => (
                  <li key={feature} className="flex items-start gap-2 text-sm">
                    <Check className="h-4 w-4 text-green-500 shrink-0 mt-0.5" />
                    <span>{feature}</span>
                  </li>
                ))}
              </ul>

              <div className="mt-auto space-y-2">
                {isActive ? (
                  <Button
                    variant="outline"
                    className="w-full"
                    onClick={handleManage}
                    disabled={manageInFlight}
                  >
                    {manageInFlight && <Loader2 className="h-4 w-4 animate-spin mr-1.5" />}
                    Manage subscription
                  </Button>
                ) : isUpgrade ? (
                  <Button
                    className="w-full bg-orange-500 hover:bg-orange-600 text-white"
                    onClick={() => handleUpgrade(plan.priceId, plan.id)}
                    disabled={!!actionLoading}
                  >
                    {inFlight && <Loader2 className="h-4 w-4 animate-spin mr-1.5" />}
                    Upgrade to {plan.name}
                  </Button>
                ) : isDowngrade ? (
                  <Button
                    variant="outline"
                    className="w-full"
                    onClick={handleManage}
                    disabled={manageInFlight}
                  >
                    {manageInFlight && <Loader2 className="h-4 w-4 animate-spin mr-1.5" />}
                    Switch to {plan.name}
                  </Button>
                ) : (
                  // trial → any plan
                  <Button
                    className="w-full bg-orange-500 hover:bg-orange-600 text-white"
                    onClick={() => handleUpgrade(plan.priceId, plan.id)}
                    disabled={!!actionLoading}
                  >
                    {inFlight && <Loader2 className="h-4 w-4 animate-spin mr-1.5" />}
                    Get started
                  </Button>
                )}

                {isActive && currentPlan !== 'trial' && (
                  <p className="text-2xs text-center text-muted-foreground">
                    Billed monthly · cancel anytime
                  </p>
                )}
              </div>
            </div>
          )
        })}
      </div>

      <p className="text-xs text-muted-foreground text-center">
        All plans include a 45-day free trial. Payments processed securely by Stripe.{' '}
        <Link to="/settings/workspace/billing" className="underline underline-offset-2">
          Questions? Contact us.
        </Link>
      </p>
    </div>
  )
}
