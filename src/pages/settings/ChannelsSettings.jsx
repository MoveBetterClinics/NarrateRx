import { useState, useEffect } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '@clerk/clerk-react'
import { Loader2, AlertCircle, ChevronDown, ChevronRight } from 'lucide-react'
import { Section, SaveBar } from '@/components/settings/helpers'
import { Separator } from '@/components/ui/separator'
import CredentialForm from '@/components/CredentialForm'
import { useUserRole } from '@/lib/useUserRole'
import { useUnsavedChanges } from '@/lib/useUnsavedChanges'
import { useSaveShortcut } from '@/lib/useSaveShortcut'
import { useDocumentTitle } from '@/lib/useDocumentTitle'
import { OUTPUT_CHANNELS } from '@/lib/outputChannels'

// Mirrors CREDENTIAL_SERVICES in WorkspaceSettings — first-party publish
// integrations only. External tenants go through Buffer.
const CREDENTIAL_SERVICES = [
  {
    id: 'buffer',
    label: 'Buffer',
    description: 'Buffer access token — routes posts to every connected channel in your Buffer org.',
    secretLabel: 'Access token',
    fields: [],
  },
  {
    id: 'wordpress',
    label: 'WordPress',
    description: 'WordPress REST publishing. site_url must include /wp-json/.',
    secretLabel: 'Application password',
    fields: [
      { key: 'site_url', label: 'Site URL (must include /wp-json/)', placeholder: 'https://example.com/wp-json/wp/v2/posts' },
      { key: 'user', label: 'WordPress username', placeholder: 'editor' },
    ],
  },
  {
    id: 'astro_github',
    label: 'Astro + GitHub website',
    description: 'Webhook publishing to an Astro site that commits markdown to GitHub.',
    secretLabel: 'Shared bearer secret',
    fields: [
      { key: 'url', label: 'Publish webhook URL', placeholder: 'https://example.com/api/publish' },
    ],
  },
]

function hasPublishCapability(ws) {
  const caps = ws?.capabilities || {}
  return Object.entries(caps).some(([k, v]) => k.endsWith('Publish') && Boolean(v))
}

function CredentialCard({ service, row, loading, onChange, getToken }) {
  const [open, setOpen] = useState(false)
  const configured = Boolean(row)
  return (
    <div className="rounded-md border border-input">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between gap-2 p-3 text-left hover:bg-accent/30"
      >
        <div className="flex items-center gap-2 min-w-0">
          {open ? <ChevronDown className="h-4 w-4 shrink-0" /> : <ChevronRight className="h-4 w-4 shrink-0" />}
          <div className="text-sm font-medium">{service.label}</div>
          {configured && (
            <span className="text-[10px] uppercase tracking-wide bg-green-100 text-green-700 px-1.5 py-0.5 rounded">
              Configured
            </span>
          )}
          {!loading && !configured && (
            <span className="text-[10px] uppercase tracking-wide bg-muted text-muted-foreground px-1.5 py-0.5 rounded">
              Not set
            </span>
          )}
        </div>
        <div className="text-[11px] text-muted-foreground truncate">{service.description}</div>
      </button>
      {open && (
        <div className="border-t border-input p-3">
          <CredentialForm
            service={service}
            row={row}
            getToken={getToken}
            tokenOpts={{ skipCache: true }}
            onChange={onChange}
            removeIcon
          />
        </div>
      )}
    </div>
  )
}

function CredentialsSection({ getToken }) {
  const [services, setServices] = useState(null)
  const [error, setError] = useState(null)

  const reload = async () => {
    try {
      const r = await fetch('/api/workspace/credentials', {
        headers: { Authorization: `Bearer ${await getToken({ skipCache: true })}` },
      })
      if (!r.ok) {
        setServices([])
        setError(r.status === 403 ? 'forbidden' : `load-failed (${r.status})`)
        return
      }
      const data = await r.json()
      setServices(Array.isArray(data?.services) ? data.services : [])
      setError(null)
    } catch {
      setServices([])
      setError('network-error')
    }
  }

  useEffect(() => { reload() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Section
      title="Publishing credentials"
      description="Stored encrypted (AES-256-GCM) and decrypted only at publish time. Secrets are write-only."
    >
      {error && (
        <div className="text-xs text-destructive flex items-center gap-1">
          <AlertCircle className="h-3.5 w-3.5" />{error}
        </div>
      )}
      <div className="space-y-2">
        {CREDENTIAL_SERVICES.map((svc) => {
          const row = services?.find?.((s) => s.service === svc.id) || null
          return (
            <CredentialCard
              key={svc.id}
              service={svc}
              row={row}
              loading={services === null}
              onChange={reload}
              getToken={getToken}
            />
          )
        })}
      </div>
    </Section>
  )
}

export default function ChannelsSettings() {
  useDocumentTitle('Settings — Output channels')
  const { getToken } = useAuth()
  const { role, isLoading: roleLoading } = useUserRole()
  const [ws, setWs]           = useState(undefined)
  const [form, setForm]       = useState(null)
  const [pristine, setPristine] = useState(null)
  const [saving, setSaving]   = useState(false)
  const [saved, setSaved]     = useState(false)
  const [error, setError]     = useState(null)

  useEffect(() => {
    fetch('/api/workspace/me')
      .then(r => r.ok ? r.json() : null)
      .catch(() => null)
      .then(data => {
        setWs(data)
        if (data) {
          const initial = { enabled_outputs: Array.isArray(data.enabled_outputs) ? data.enabled_outputs : [] }
          setForm(initial)
          setPristine(initial)
        }
      })
  }, [])

  const isDirty = !!form && !!pristine && JSON.stringify(form) !== JSON.stringify(pristine)
  useUnsavedChanges(isDirty)
  useSaveShortcut(() => { if (isDirty && !saving) handleSave() }, { disabled: !isDirty || saving })

  async function handleSave() {
    setSaving(true); setError(null); setSaved(false)
    try {
      const token = await getToken()
      const r = await fetch('/api/workspace/me', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ enabled_outputs: form.enabled_outputs }),
      })
      if (!r.ok) {
        const err = await r.json().catch(() => ({}))
        setError(err.error || 'save-failed')
      } else {
        const updated = await r.json()
        const refreshed = { enabled_outputs: Array.isArray(updated.enabled_outputs) ? updated.enabled_outputs : [] }
        setForm(refreshed); setPristine(refreshed)
        setSaved(true); setTimeout(() => setSaved(false), 3000)
      }
    } catch {
      setError('network-error')
    } finally {
      setSaving(false)
    }
  }

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
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Output channels</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Choose which channels this workspace generates. Each interview lets you pick a subset.
        </p>
      </div>

      <Section
        title="Enabled channels"
        description="Each interview lets you pick a subset of these for that content piece."
      >
        <div className="space-y-2">
          {Object.values(OUTPUT_CHANNELS).map((channel) => {
            const checked = form.enabled_outputs.includes(channel.id)
            return (
              <label
                key={channel.id}
                className="flex items-start gap-2.5 rounded-md border border-input p-2.5 cursor-pointer hover:bg-accent/30"
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={(e) => {
                    setForm((f) => {
                      const cur = Array.isArray(f.enabled_outputs) ? f.enabled_outputs : []
                      const next = e.target.checked
                        ? (cur.includes(channel.id) ? cur : [...cur, channel.id])
                        : cur.filter((id) => id !== channel.id)
                      return { ...f, enabled_outputs: next }
                    })
                  }}
                  className="mt-0.5"
                />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium leading-tight">{channel.label}</div>
                  <div className="text-[11px] text-muted-foreground mt-0.5">{channel.exportShape}</div>
                </div>
              </label>
            )
          })}
        </div>
      </Section>

      <SaveBar
        saving={saving} saved={saved} error={error} isDirty={isDirty}
        onSave={handleSave}
        onDiscard={() => { setForm(pristine); setError(null) }}
      />

      {hasPublishCapability(ws) && (
        <>
          <Separator />
          <CredentialsSection getToken={getToken} />
        </>
      )}
    </div>
  )
}
