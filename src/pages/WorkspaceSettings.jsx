import { useState, useEffect } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '@clerk/clerk-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Separator } from '@/components/ui/separator'
import { Loader2, CheckCircle2, AlertCircle } from 'lucide-react'
import { useUserRole } from '@/lib/useUserRole'

function formFromWorkspace(ws) {
  return {
    display_name:            ws.display_name            ?? '',
    tagline:                 ws.tagline                 ?? '',
    sign_in_blurb:           ws.sign_in_blurb           ?? '',
    website:                 ws.website                 ?? '',
    location:                ws.location                ?? '',
    region:                  ws.region                  ?? '',
    social_instagram:        ws.social?.instagram       ?? '',
    social_facebook:         ws.social?.facebook        ?? '',
    clinic_context:          ws.clinic_context          ?? '',
    audience_short:          ws.audience_short          ?? '',
    brand_voice:             ws.brand_voice             ?? '',
    booking_url:             ws.booking_url             ?? '',
    internal_links_markdown: ws.internal_links_markdown ?? '',
    signature_system_name:   ws.signature_system_name   ?? '',
    signature_system_url:    ws.signature_system_url    ?? '',
  }
}

function formToPatch(form) {
  return {
    display_name:            form.display_name,
    tagline:                 form.tagline,
    sign_in_blurb:           form.sign_in_blurb,
    website:                 form.website,
    location:                form.location,
    region:                  form.region,
    social: {
      instagram: form.social_instagram,
      facebook:  form.social_facebook,
    },
    clinic_context:          form.clinic_context,
    audience_short:          form.audience_short,
    brand_voice:             form.brand_voice,
    booking_url:             form.booking_url,
    internal_links_markdown: form.internal_links_markdown,
    signature_system_name:   form.signature_system_name || null,
    signature_system_url:    form.signature_system_url  || null,
  }
}

export default function WorkspaceSettings() {
  const { getToken } = useAuth()
  const { role, isLoading: roleLoading } = useUserRole()
  const [ws, setWs]       = useState(undefined) // undefined=loading, null=no-context, object=loaded
  const [form, setForm]   = useState(null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved]   = useState(false)
  const [error, setError]   = useState(null)

  useEffect(() => {
    fetch('/api/workspace/me')
      .then(r => r.ok ? r.json() : null)
      .catch(() => null)
      .then(data => {
        setWs(data)
        if (data) setForm(formFromWorkspace(data))
      })
  }, [])

  async function handleSave() {
    setSaving(true)
    setError(null)
    setSaved(false)
    try {
      const token = await getToken()
      const r = await fetch('/api/workspace/me', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(formToPatch(form)),
      })
      if (!r.ok) {
        const err = await r.json().catch(() => ({}))
        setError(err.error || 'save-failed')
      } else {
        const updated = await r.json()
        setWs(updated)
        setForm(formFromWorkspace(updated))
        setSaved(true)
        setTimeout(() => setSaved(false), 3000)
      }
    } catch {
      setError('network-error')
    } finally {
      setSaving(false)
    }
  }

  function set(key) {
    return v => setForm(f => ({ ...f, [key]: v }))
  }

  if (roleLoading || ws === undefined) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (role !== 'admin') {
    return <Navigate to="/" replace />
  }

  if (!ws) {
    return (
      <div className="max-w-2xl mx-auto py-16 text-center space-y-2">
        <p className="text-muted-foreground text-sm">
          Workspace settings are only available on the shared NarrateRx deployment
          (<code className="font-mono text-xs">*.narraterx.ai</code>).
        </p>
      </div>
    )
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Workspace Settings</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Edit your workspace profile and AI voice context.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0 pt-1">
          {saved && (
            <span className="text-xs text-green-600 flex items-center gap-1">
              <CheckCircle2 className="h-3.5 w-3.5" />Saved
            </span>
          )}
          {error && (
            <span className="text-xs text-destructive flex items-center gap-1">
              <AlertCircle className="h-3.5 w-3.5" />{error}
            </span>
          )}
          <Button size="sm" onClick={handleSave} disabled={saving}>
            {saving && <Loader2 className="h-4 w-4 animate-spin mr-1.5" />}
            Save changes
          </Button>
        </div>
      </div>

      <Section title="Identity">
        <Field label="Workspace name"
          value={form.display_name} onChange={set('display_name')} />
        <Field label="Tagline"
          value={form.tagline} onChange={set('tagline')} />
        <Field label="Sign-in blurb"
          value={form.sign_in_blurb} onChange={set('sign_in_blurb')}
          hint="Shown below the workspace name on the sign-in screen." />
      </Section>

      <Separator />

      <Section title="Web presence">
        <Field label="Website"
          value={form.website} onChange={set('website')} placeholder="https://..." />
        <Field label="Location"
          value={form.location} onChange={set('location')} placeholder="City, State" />
        <Field label="Region"
          value={form.region} onChange={set('region')} placeholder="Pacific Northwest" />
      </Section>

      <Separator />

      <Section title="Social handles">
        <Field label="Instagram handle"
          value={form.social_instagram} onChange={set('social_instagram')} placeholder="yourhandle" />
        <Field label="Facebook handle"
          value={form.social_facebook} onChange={set('social_facebook')} placeholder="yourpage" />
      </Section>

      <Separator />

      <Section
        title="AI voice context"
        description="Injected into AI prompts. Write these as if briefing a copywriter."
      >
        <Textarea2 label="Clinic context"
          value={form.clinic_context} onChange={set('clinic_context')} rows={3} />
        <Field label="Audience (short)"
          value={form.audience_short} onChange={set('audience_short')} />
        <Textarea2 label="Brand voice"
          value={form.brand_voice} onChange={set('brand_voice')} rows={6} />
        <Field label="Booking URL"
          value={form.booking_url} onChange={set('booking_url')} placeholder="https://..." />
      </Section>

      <Separator />

      <Section title="Content">
        <Textarea2
          label="Internal links (Markdown)"
          value={form.internal_links_markdown}
          onChange={set('internal_links_markdown')}
          rows={8}
          hint="Markdown list of pages. The blog post prompt uses these for contextual linking."
        />
        <Field label="Signature system name"
          value={form.signature_system_name} onChange={set('signature_system_name')}
          placeholder="Leave blank if none" />
        <Field label="Signature system URL"
          value={form.signature_system_url} onChange={set('signature_system_url')}
          placeholder="https://..." />
      </Section>
    </div>
  )
}

function Section({ title, description, children }) {
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-sm font-semibold">{title}</h2>
        {description && <p className="text-xs text-muted-foreground mt-0.5">{description}</p>}
      </div>
      <div className="space-y-3">
        {children}
      </div>
    </div>
  )
}

function Field({ label, value, onChange, placeholder, hint }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      <Input
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className="text-sm"
      />
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  )
}

function Textarea2({ label, value, onChange, rows = 4, hint }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      <Textarea
        value={value}
        onChange={e => onChange(e.target.value)}
        rows={rows}
        className="text-sm font-mono resize-y"
      />
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  )
}
