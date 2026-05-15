import { useEffect, useState } from 'react'
import { Navigate, useSearchParams } from 'react-router-dom'
import { Loader2, CheckCircle2, AlertCircle } from 'lucide-react'
import PricingCards from '@/components/billing/PricingCards'
import { useUserRole } from '@/lib/useUserRole'
import { useDocumentTitle } from '@/lib/useDocumentTitle'

// Billing tab lifted from WorkspaceSettings. Pure UI — plan changes flow
// through PricingCards' Stripe checkout. The return-from-Stripe toasts
// (`?billing=success` / `?billing=cancelled`) live here now since this is
// where the Stripe return_url points.
export default function BillingSettings() {
  useDocumentTitle('Settings — Plan & billing')
  const { role, isLoading: roleLoading } = useUserRole()
  const [searchParams, setSearchParams] = useSearchParams()
  const [ws, setWs] = useState(undefined)
  const [billingToast, setBillingToast] = useState(null) // 'success' | 'cancelled' | null

  useEffect(() => {
    fetch('/api/workspace/me')
      .then(r => r.ok ? r.json() : null)
      .catch(() => null)
      .then(setWs)
  }, [])

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
  if (role !== 'admin') return <Navigate to="/" replace />
  if (!ws) return (
    <div className="py-16 text-center text-sm text-muted-foreground">
      Workspace settings are only available on a <code className="font-mono text-xs">*.narraterx.ai</code> deployment.
    </div>
  )

  return (
    <div className="max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Plan &amp; billing</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Manage your subscription plan. Changes take effect immediately.
        </p>
      </div>

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

      {ws.plan && ws.plan !== 'trial' && (
        <div className="text-xs text-muted-foreground">
          Current plan: <span className="font-semibold capitalize text-foreground">{ws.plan}</span>
          {ws.plan_seats && ws.plan_seats < 999 && (
            <> &middot; up to {ws.plan_seats} staff members</>
          )}
        </div>
      )}

      <PricingCards currentPlan={ws.plan || 'trial'} />
    </div>
  )
}
