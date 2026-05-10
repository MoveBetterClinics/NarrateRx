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
import { OUTPUT_CHANNELS } from '@/lib/outputChannels'

function formFromWorkspace(ws) {
  return {
    display_name:            ws.display_name            ?? '',
    tagline:                 ws.tagline                 ?? '',
    sign_in_blurb:           ws.sign_in_blurb           ?? '',
    app_name:                ws.app_name                ?? '',
    website:                 ws.website                 ?? '',
    location:                ws.location                ?? '',
    region:                  ws.region                  ?? '',
    region_short:            ws.region_short            ?? '',
    website_hostname:        ws.website_hostname        ?? '',
    link_preview_blurb:      ws.link_preview_blurb      ?? '',
    social_instagram:        ws.social?.instagram       ?? '',
    social_facebook:         ws.social?.facebook        ?? '',
    clinic_context:          ws.clinic_context          ?? '',
    audience_short:          ws.audience_short          ?? '',
    audience_description:    ws.audience_description    ?? '',
    activity_context:        ws.activity_context        ?? '',
    brand_voice:             ws.brand_voice             ?? '',
    booking_url:             ws.booking_url             ?? '',
    internal_links_markdown: ws.internal_links_markdown ?? '',
    signature_system_name:   ws.signature_system_name   ?? '',
    signature_system_url:    ws.signature_system_url    ?? '',
    pinterest_boards:        ws.pinterest_boards        ?? '',
    location_keyword:        ws.location_keyword        ?? '',
    location_hashtag:        ws.location_hashtag        ?? '',
    brand_hashtag:           ws.brand_hashtag           ?? '',
    spoken_url:              ws.spoken_url              ?? '',
    enabled_outputs:         Array.isArray(ws.enabled_outputs) ? ws.enabled_outputs : [],
  }
}

function formToPatch(form) {
  return {
    display_name:            form.display_name,
    tagline:                 form.tagline,
    sign_in_blurb:           form.sign_in_blurb,
    app_name:                form.app_name,
    website:                 form.website,
    location:                form.location,
    region:                  form.region,
    region_short:            form.region_short,
    website_hostname:        form.website_hostname,
    link_preview_blurb:      form.link_preview_blurb,
    social: {
      instagram: form.social_instagram,
      facebook:  form.social_facebook,
    },
    clinic_context:          form.clinic_context,
    audience_short:          form.audience_short,
    audience_description:    form.audience_description,
    activity_context:        form.activity_context,
    brand_voice:             form.brand_voice,
    booking_url:             form.booking_url,
    internal_links_markdown: form.internal_links_markdown,
    signature_system_name:   form.signature_system_name || null,
    signature_system_url:    form.signature_system_url  || null,
    pinterest_boards:        form.pinterest_boards,
    location_keyword:        form.location_keyword,
    location_hashtag:        form.location_hashtag,
    brand_hashtag:           form.brand_hashtag,
    spoken_url:              form.spoken_url,
    enabled_outputs:         form.enabled_outputs ?? [],
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
        <Field label="App name"
          value={form.app_name} onChange={set('app_name')}
          hint="App name in browser tab — e.g. 'Move Better — NarrateRx'" />
      </Section>

      <Separator />

      <Section title="Web presence">
        <Field label="Website"
          value={form.website} onChange={set('website')} placeholder="https://..." />
        <Field label="Website hostname"
          value={form.website_hostname} onChange={set('website_hostname')}
          placeholder="movebetter.co"
          hint="Hostname only — e.g. movebetter.co" />
        <Field label="Location"
          value={form.location} onChange={set('location')} placeholder="City, State" />
        <Field label="Region"
          value={form.region} onChange={set('region')} placeholder="Pacific Northwest" />
        <Field label="Region (short)"
          value={form.region_short} onChange={set('region_short')}
          placeholder="PNW"
          hint="Short region code — e.g. PNW" />
        <Textarea2 label="Link preview blurb"
          value={form.link_preview_blurb} onChange={set('link_preview_blurb')}
          rows={2}
          hint="OG / link-preview blurb — one sentence under 130 chars" />
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
        <Textarea2 label="Audience (long form)"
          value={form.audience_description} onChange={set('audience_description')}
          rows={4}
          hint="Full description of who you're writing for" />
        <Field label="Activity context"
          value={form.activity_context} onChange={set('activity_context')}
          hint="Sport / discipline / lifestyle vocabulary used in 'active' tone" />
        <Textarea2 label="Brand voice"
          value={form.brand_voice} onChange={set('brand_voice')} rows={6} />
        <Field label="Booking URL"
          value={form.booking_url} onChange={set('booking_url')} placeholder="https://..." />
      </Section>

      <Separator />

      <Section
        title="Output channels"
        description="Choose which output channels this workspace generates. Each interview lets you pick a subset of these for that piece."
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
                  <div className="text-[11px] text-muted-foreground mt-0.5">
                    {channel.exportShape}
                  </div>
                </div>
              </label>
            )
          })}
        </div>
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
        <Field label="Pinterest board names"
          value={form.pinterest_boards} onChange={set('pinterest_boards')}
          hint="Pinterest board names — slash-separated" />
        <Field label="Location keyword"
          value={form.location_keyword} onChange={set('location_keyword')}
          placeholder="Portland"
          hint="Location keyword — e.g. 'Portland'" />
        <Field label="Location hashtag"
          value={form.location_hashtag} onChange={set('location_hashtag')}
          placeholder="#PortlandChiropractor"
          hint="Location hashtag — e.g. #PortlandChiropractor" />
        <Field label="Brand hashtag"
          value={form.brand_hashtag} onChange={set('brand_hashtag')}
          placeholder="#MoveBetter"
          hint="Brand hashtag — e.g. #MoveBetter" />
        <Field label="Spoken URL"
          value={form.spoken_url} onChange={set('spoken_url')}
          placeholder="MoveBetter.co"
          hint="Spoken URL — said aloud in video scripts, e.g. MoveBetter.co" />
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
