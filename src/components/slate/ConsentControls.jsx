import { useState } from 'react'
import { Loader2, ShieldCheck, ShieldAlert, ShieldOff, Shield } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { apiFetch } from '@/lib/api'
import { toast } from '@/lib/toast'

const STATUS_META = {
  not_required: { label: 'No consent needed',  icon: Shield,       cls: 'text-muted-foreground' },
  pending:      { label: 'Consent pending',    icon: ShieldAlert,  cls: 'text-amber-700' },
  obtained:     { label: 'Consent obtained',   icon: ShieldCheck,  cls: 'text-emerald-700' },
  revoked:      { label: 'Consent revoked',    icon: ShieldOff,    cls: 'text-destructive' },
}

/**
 * Inline consent management for a package's source asset.
 * Shown above the action row on PackageCard.
 *
 * @param {{
 *   sourceAssetId: string,
 *   consentStatus: 'not_required'|'pending'|'obtained'|'revoked',
 *   onUpdate?: (newStatus: string) => void
 * }}
 */
export default function ConsentControls({ sourceAssetId, consentStatus = 'not_required', onUpdate }) {
  const [saving, setSaving] = useState(false)
  const [status, setStatus] = useState(consentStatus)
  const meta = STATUS_META[status] || STATUS_META.not_required
  const Icon = meta.icon

  // 'not_required' is the default — no need to surface the consent UI on
  // assets where consent isn't a concern. Show a discreet flag-for-review
  // affordance instead so clinicians can opt in to tracking when needed.
  if (status === 'not_required') {
    return (
      <div className="flex items-center justify-between gap-2 px-3 py-2 border-t border-border bg-muted/20">
        <span className="text-2xs text-muted-foreground inline-flex items-center gap-1">
          <Shield className="h-3 w-3" />
          No consent flag
        </span>
        <button
          type="button"
          className="text-2xs text-muted-foreground hover:text-amber-700 font-medium"
          onClick={() => updateConsent('pending')}
          disabled={saving}
        >
          {saving ? <Loader2 className="h-3 w-3 animate-spin inline" /> : 'Flag for review'}
        </button>
      </div>
    )
  }

  async function updateConsent(newStatus) {
    if (!sourceAssetId) {
      toast.error('Cannot update consent — package has no source asset.')
      return
    }
    setSaving(true)
    try {
      await apiFetch(`/api/media/${sourceAssetId}/consent`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      })
      setStatus(newStatus)
      onUpdate?.(newStatus)
      toast(`Consent ${newStatus === 'not_required' ? 'cleared' : newStatus}.`)
    } catch (err) {
      toast.error(err?.message || 'Failed to update consent.')
    } finally {
      setSaving(false)
    }
  }

  const bgCls =
    status === 'pending'  ? 'bg-amber-50 border-amber-200'         :
    status === 'obtained' ? 'bg-emerald-50 border-emerald-200'     :
    status === 'revoked'  ? 'bg-destructive/5 border-destructive/30' :
                            'bg-muted/30 border-border'

  return (
    <div className={`flex flex-col gap-1.5 px-3 py-2 border-t ${bgCls}`}>
      <div className="flex items-center justify-between gap-2">
        <span className={`text-2xs font-semibold inline-flex items-center gap-1 ${meta.cls}`}>
          <Icon className="h-3 w-3" />
          {meta.label}
        </span>
        {saving && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
      </div>
      <div className="flex gap-1 flex-wrap">
        {status !== 'obtained' && (
          <Button
            size="sm"
            variant="outline"
            className="h-6 text-3xs px-2 border-emerald-300 text-emerald-700 hover:bg-emerald-100"
            onClick={() => updateConsent('obtained')}
            disabled={saving}
          >
            Obtained
          </Button>
        )}
        {status !== 'not_required' && (
          <Button
            size="sm"
            variant="outline"
            className="h-6 text-3xs px-2"
            onClick={() => updateConsent('not_required')}
            disabled={saving}
          >
            Not needed
          </Button>
        )}
        {status !== 'revoked' && status !== 'pending' && (
          <Button
            size="sm"
            variant="outline"
            className="h-6 text-3xs px-2 border-destructive/30 text-destructive hover:bg-destructive/10"
            onClick={() => updateConsent('revoked')}
            disabled={saving}
          >
            Revoke
          </Button>
        )}
      </div>
    </div>
  )
}
