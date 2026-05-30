import { useEffect, useState } from 'react'
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import { Loader2, CheckCircle2, AlertCircle, Sparkles } from 'lucide-react'
import PricingCards from '@/components/billing/PricingCards'
import { useUserRole } from '@/lib/useUserRole'
import { usePermission } from '@/lib/usePermission'
import { CAP_BILLING_VIEW } from '@/lib/capabilities'
import { useDocumentTitle } from '@/lib/useDocumentTitle'
import { apiFetch } from '@/lib/api'

// Billing tab lifted from WorkspaceSettings. Pure UI — plan changes flow
// through PricingCards' Stripe checkout. The return-from-Stripe toasts
// (`?billing=success` / `?billing=cancelled`) live here now since this is
// where the Stripe return_url points.
//
// Also handles `?onboarding=1` — the post-brand-kit redirect from new tenants.
// Internal workspaces (plan='internal') skip straight to home.
export default function BillingSettings() {
  useDocumentTitle('Settings — Plan & billing')
  const { role, isLoading: roleLoading } = useUserRole()
  const { has } = usePermission()
  const [searchParams, setSearchParams] = useSearchParams()
  const navigate = useNavigate()
  const [ws, setWs] = useState(undefined)
  const [billingToast, setBillingToast] = useState(null) // 'success' | 'cancelled' | null
  const isOnboarding = searchParams.get('onboarding') === '1'

  useEffect(() => {
    // Authenticated load — needs the bearer token to get the full row
    // (with `plan`); a tokenless fetch returns the slim branding shape.
    apiFetch('/api/workspace/me')
      .then(setWs)
      .catch(() => setWs(null))
  }, [])

  // Internal workspaces don't pay — skip straight to home after onboarding.
  useEffect(() => {
    if (isOnboarding && ws?.plan === 'internal') {
      navigate('/?welcome=1', { replace: true })
    }
  }, [isOnboarding, ws, navigate])

  useEffect(() => {
    const billing = searchParams.get('billing')
    if (billing === 'success' || billing === 'cancelled') {
      setBillingToast(billing)
      const next = new URLSearchParams(searchParams)
      next.delete('billing')
      setSearchParams(next, { replace: true })
      const t = setTimeout(() => setBillingToast(null), 5000)
      return () => clearTimeout(t)
    }
  }, [searchParams, setSearchParams])

  if (roleLoading || ws === undefined) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    )
  }
  // Phase 4 PR 2: capability-based redirect. Producer (no CAP_BILLING_VIEW) is
  // bounced home along with non-staff.
  if (role !== 'admin' || !has(CAP_BILLING_VIEW)) return <Navigate to="/" replace />
  if (!ws) return (
    <div className="py-16 text-center text-sm text-muted-foreground">
      Workspace settings are only available on a <code className="font-mono text-xs">*.narraterx.ai</code> deployment.
    </div>
  )

  return (
    <div className="space-y-6">
      {isOnboarding ? (
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Sparkles className="h-5 w-5 text-orange-500" />
            <h1 className="text-2xl font-bold tracking-tight">One last step</h1>
          </div>
          <p className="text-muted-foreground text-sm">
            Your workspace is ready. Choose a plan to start publishing — you can change or cancel anytime.
          </p>
        </div>
      ) : (
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center">
            <span
              className="inline-block w-1 h-6 rounded-full shrink-0 mr-2.5"
              style={{ background: 'hsl(var(--primary))' }}
              aria-hidden="true"
            />
            Plan &amp; billing
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Manage your subscription plan. Changes take effect immediately.
          </p>
        </div>
      )}

      {billingToast === 'success' && (
        <div className="flex items-center gap-2 rounded-md bg-green-50 border border-green-200 px-4 py-3 text-sm text-green-800">
          <CheckCircle2 className="h-4 w-4 shrink-0 text-green-600" />
          <span><strong>Subscription activated!</strong> Your plan has been updated.</span>
        </div>
      )}
      {billingToast === 'cancelled' && (
        <div className="flex items-center gap-2 rounded-md bg-muted border border-border px-4 py-3 text-sm text-muted-foreground">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>Checkout cancelled — no changes were made.</span>
        </div>
      )}

      {!isOnboarding && ws.plan && ws.plan !== 'trial' && ws.plan !== 'internal' && (
        <div className="text-xs text-muted-foreground">
          Current plan: <span className="font-semibold capitalize text-foreground">{ws.plan}</span>
          {ws.plan_seats && ws.plan_seats < 999 && (
            <> &middot; up to {ws.plan_seats} staff members</>
          )}
        </div>
      )}

      <PricingCards currentPlan={ws.plan || 'trial'} />

      {isOnboarding && (
        <div className="rounded-xl border border-dashed border-border bg-muted/40 px-6 py-5 flex flex-col items-center gap-2 text-center">
          <p className="text-sm font-medium">Not ready to subscribe yet?</p>
          <p className="text-xs text-muted-foreground max-w-sm">
            Start your <strong>45-day free trial</strong> — full access, no credit card required.
            You can choose a plan any time before it ends.
          </p>
          <button
            className="mt-1 inline-flex items-center justify-center rounded-md border border-border bg-background px-5 py-2 text-sm font-medium shadow-sm hover:bg-accent transition-colors"
            onClick={() => navigate('/?welcome=1', { replace: true })}
          >
            Start free trial — decide later
          </button>
        </div>
      )}
    </div>
  )
}
