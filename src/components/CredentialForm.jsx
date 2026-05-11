import { useEffect, useState } from 'react'
import { CheckCircle2, AlertCircle, Loader2, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'

// Shared per-service publishing-credentials form. Owns config/secret state,
// save (PUT /api/workspace/credentials) and remove (DELETE) handlers, plus the
// fields / secret input / action-row UI. Card chrome (collapse toggle,
// badges, setup steps) is left to the caller — see Integrations.jsx and
// WorkspaceSettings.jsx for the two surfaces this drives.

function emptyConfigFor(service) {
  const out = {}
  for (const f of service.fields || []) out[f.key] = ''
  return out
}

function configFromRow(service, row) {
  const cfg = emptyConfigFor(service)
  if (!row?.config) return cfg
  for (const f of service.fields || []) {
    const v = row.config[f.key]
    if (f.isCsv) cfg[f.key] = Array.isArray(v) ? v.join(', ') : (v ?? '')
    else cfg[f.key] = v ?? ''
  }
  return cfg
}

function configToPayload(service, cfg) {
  const out = {}
  for (const f of service.fields || []) {
    const v = cfg[f.key] ?? ''
    if (f.isCsv) out[f.key] = String(v).split(',').map((s) => s.trim()).filter(Boolean)
    else out[f.key] = String(v).trim()
  }
  return out
}

export default function CredentialForm({
  service,
  row,
  disabled = false,
  getToken,
  tokenOpts,
  onChange,
  saveLabel,
  removeLabel = 'Remove',
  removeIcon = false,
  confirmMessage,
  secretPlaceholder,
}) {
  const [config, setConfig] = useState(() => configFromRow(service, row))
  const [secret, setSecret] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState(null)
  const configured = Boolean(row)

  useEffect(() => {
    setConfig(configFromRow(service, row))
  }, [service, row])

  const tokenArg = tokenOpts ? () => getToken(tokenOpts) : () => getToken()

  async function handleSave() {
    setError(null)
    setSaved(false)
    if (!secret) {
      setError('Secret is required')
      return
    }
    setSaving(true)
    try {
      const r = await fetch('/api/workspace/credentials', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${await tokenArg()}`,
        },
        body: JSON.stringify({
          service: service.id,
          config: configToPayload(service, config),
          secret,
        }),
      })
      if (!r.ok) {
        const e = await r.json().catch(() => ({}))
        setError(e.error || 'save-failed')
      } else {
        setSecret('')
        setSaved(true)
        setTimeout(() => setSaved(false), 3000)
        onChange?.()
      }
    } catch {
      setError('network-error')
    } finally {
      setSaving(false)
    }
  }

  async function handleRemove() {
    if (!configured) return
    const msg = confirmMessage?.(service) || `Remove ${service.label} credentials for this workspace?`
    if (!confirm(msg)) return
    setSaving(true)
    setError(null)
    try {
      const r = await fetch(`/api/workspace/credentials?service=${encodeURIComponent(service.id)}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${await tokenArg()}` },
      })
      if (!r.ok) {
        const e = await r.json().catch(() => ({}))
        setError(e.error || 'remove-failed')
      } else {
        setSecret('')
        setConfig(emptyConfigFor(service))
        onChange?.()
      }
    } catch {
      setError('network-error')
    } finally {
      setSaving(false)
    }
  }

  const resolvedSaveLabel =
    typeof saveLabel === 'function'
      ? saveLabel({ configured })
      : (saveLabel ?? 'Save')
  const resolvedSecretPlaceholder = configured
    ? '•••••• (write-only — paste a new value to rotate)'
    : (secretPlaceholder ?? 'Paste secret here')

  return (
    <div className="space-y-3">
      {(service.fields || []).map((f) => (
        <div className="space-y-1" key={f.key}>
          <Label className="text-xs">{f.label}</Label>
          <Input
            value={config[f.key] ?? ''}
            onChange={(e) => setConfig((c) => ({ ...c, [f.key]: e.target.value }))}
            placeholder={f.placeholder}
            className="text-sm"
            disabled={disabled}
          />
        </div>
      ))}
      <div className="space-y-1">
        <Label className="text-xs">{service.secretLabel}</Label>
        {service.secretIsTextarea ? (
          <Textarea
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
            rows={4}
            placeholder={resolvedSecretPlaceholder}
            className="text-sm font-mono resize-y"
            disabled={disabled}
          />
        ) : (
          <Input
            type="password"
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
            placeholder={resolvedSecretPlaceholder}
            className="text-sm"
            disabled={disabled}
          />
        )}
        <p className="text-[11px] text-muted-foreground">
          Stored encrypted. Secrets never come back on read — to rotate, paste a new value and save.
        </p>
      </div>
      <div className="flex items-center gap-2 justify-end">
        {saved && (
          <span className="text-xs text-green-600 flex items-center gap-1">
            <CheckCircle2 className="h-3.5 w-3.5" /> Saved
          </span>
        )}
        {error && (
          <span className="text-xs text-destructive flex items-center gap-1">
            <AlertCircle className="h-3.5 w-3.5" /> {error}
          </span>
        )}
        {configured && (
          <Button variant="ghost" size="sm" onClick={handleRemove} disabled={disabled || saving}>
            {removeIcon && <Trash2 className="h-3.5 w-3.5 mr-1" />}
            {removeLabel}
          </Button>
        )}
        <Button size="sm" onClick={handleSave} disabled={disabled || saving}>
          {saving && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />}
          {resolvedSaveLabel}
        </Button>
      </div>
    </div>
  )
}
