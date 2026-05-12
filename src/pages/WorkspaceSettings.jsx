import { useState, useEffect } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '@clerk/clerk-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Separator } from '@/components/ui/separator'
import { Loader2, CheckCircle2, AlertCircle, ChevronDown, ChevronRight, Trash2, Plus, Star, Upload, Image as ImageIcon } from 'lucide-react'
import CredentialForm from '@/components/CredentialForm'
import MediaPicker from '@/components/MediaPicker'
import { useUserRole } from '@/lib/useUserRole'
import { OUTPUT_CHANNELS } from '@/lib/outputChannels'
import { useUnsavedChanges } from '@/lib/useUnsavedChanges'
import { useSaveShortcut } from '@/lib/useSaveShortcut'

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
    logo_main:               ws.logo?.main              ?? '',
    logo_icon:               ws.logo?.icon              ?? '',
    color_primary:           ws.colors?.primary         ?? '',
    color_secondary:         ws.colors?.secondary       ?? '',
    color_accent:            ws.colors?.accent          ?? '',
    brandbook_url:           ws.brandbook?.url          ?? '',
    brandbook_notes:         ws.brandbook?.notes        ?? '',
    tone_active:             ws.tone_modifiers?.active   ?? '',
    tone_clinical:           ws.tone_modifiers?.clinical ?? '',
    tone_warm:               ws.tone_modifiers?.warm     ?? '',
    tone_smart:              ws.tone_modifiers?.smart    ?? '',
    patient_context_json:    JSON.stringify(ws.patient_context   ?? {}, null, 2),
    interview_context_json:  JSON.stringify(ws.interview_context ?? {}, null, 2),
    topic_suggestions_json:  JSON.stringify(ws.topic_suggestions ?? [], null, 2),
  }
}

function tryParseJson(text, fallback) {
  if (!text || !text.trim()) return { ok: true, value: fallback }
  try {
    return { ok: true, value: JSON.parse(text) }
  } catch (e) {
    return { ok: false, error: e.message }
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
    logo: {
      main: form.logo_main || null,
      icon: form.logo_icon || null,
    },
    colors: {
      primary:   form.color_primary   || null,
      secondary: form.color_secondary || null,
      accent:    form.color_accent    || null,
    },
    brandbook: {
      url:   form.brandbook_url   || null,
      notes: form.brandbook_notes || null,
    },
    tone_modifiers: {
      active:   form.tone_active   ?? '',
      clinical: form.tone_clinical ?? '',
      warm:     form.tone_warm     ?? '',
      smart:    form.tone_smart    ?? '',
    },
    patient_context:   form._parsed_patient_context,
    interview_context: form._parsed_interview_context,
    topic_suggestions: form._parsed_topic_suggestions,
  }
}

// True if any first-party publish capability flag is set on this workspace.
// External (founding) workspaces have capabilities={} and the credentials
// section is hidden — direct-publish integrations are first-party only per
// the export-first scope decision.
function hasPublishCapability(ws) {
  const caps = ws?.capabilities || {}
  return Object.entries(caps).some(([k, v]) => k.endsWith('Publish') && Boolean(v))
}

export default function WorkspaceSettings() {
  const { getToken } = useAuth()
  const { role, isLoading: roleLoading } = useUserRole()
  const [ws, setWs]       = useState(undefined) // undefined=loading, null=no-context, object=loaded
  const [form, setForm]   = useState(null)
  const [pristineForm, setPristineForm] = useState(null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved]   = useState(false)
  const [error, setError]   = useState(null)

  useEffect(() => {
    fetch('/api/workspace/me')
      .then(r => r.ok ? r.json() : null)
      .catch(() => null)
      .then(data => {
        setWs(data)
        if (data) {
          const initial = formFromWorkspace(data)
          setForm(initial)
          setPristineForm(initial)
        }
      })
  }, [])

  // Warn before tab close / refresh / typed-URL when the page has unsaved
  // edits. Cheap JSON compare — the form has ~80 fields, well under the
  // threshold where stringify is a perf concern.
  const isDirty = !!form && !!pristineForm && JSON.stringify(form) !== JSON.stringify(pristineForm)
  useUnsavedChanges(isDirty)
  // ⌘S / Ctrl+S triggers the same Save button the user would click. Disabled
  // when there's nothing to save or a save is already in flight.
  useSaveShortcut(() => { if (isDirty && !saving) handleSave() }, { disabled: !isDirty || saving })

  async function handleSave() {
    setSaving(true)
    setError(null)
    setSaved(false)
    try {
      const pc = tryParseJson(form.patient_context_json, {})
      const ic = tryParseJson(form.interview_context_json, {})
      const ts = tryParseJson(form.topic_suggestions_json, [])
      if (!pc.ok)  { setError(`Patient context JSON: ${pc.error}`);   setSaving(false); return }
      if (!ic.ok)  { setError(`Interview context JSON: ${ic.error}`); setSaving(false); return }
      if (!ts.ok)  { setError(`Topic suggestions JSON: ${ts.error}`); setSaving(false); return }
      const formWithParsed = {
        ...form,
        _parsed_patient_context:   pc.value,
        _parsed_interview_context: ic.value,
        _parsed_topic_suggestions: ts.value,
      }
      const token = await getToken()
      const r = await fetch('/api/workspace/me', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(formToPatch(formWithParsed)),
      })
      if (!r.ok) {
        const err = await r.json().catch(() => ({}))
        setError(err.error || 'save-failed')
      } else {
        const updated = await r.json()
        setWs(updated)
        const refreshed = formFromWorkspace(updated)
        setForm(refreshed)
        setPristineForm(refreshed)
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

      <Section
        title="Locations"
        description="Each physical site you operate. The primary location's city/state and hashtag are mirrored back to the umbrella fields above so existing prompts keep rendering. Per-post location targeting comes online in a follow-up."
      >
        <LocationsPanel getToken={getToken} onSyncWorkspace={() => {
          // Reload workspace so umbrella fields (location/keyword/hashtag)
          // reflect the latest primary.
          fetch('/api/workspace/me')
            .then(r => r.ok ? r.json() : null)
            .then(updated => {
              if (updated) {
                setWs(updated)
                const refreshed = formFromWorkspace(updated)
                setForm(refreshed)
                setPristineForm(refreshed)
              }
            })
            .catch(() => {})
        }} />
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
        title="Brand assets"
        description="Logos, colors, and brandbook reference. Used for link previews, social avatars, and image generation. Logo uploads are stored in your Media library."
      >
        <LogoField label="Logo (main)"
          value={form.logo_main} onChange={set('logo_main')}
          hint="Wordmark / horizontal logo for headers and link previews." />
        <LogoField label="Logo (icon)"
          value={form.logo_icon} onChange={set('logo_icon')}
          hint="Square mark for social avatars and favicons." />
        <Field label="Primary color"
          value={form.color_primary} onChange={set('color_primary')}
          placeholder="#E36525" hint="Hex code (e.g. #E36525)." />
        <Field label="Secondary color"
          value={form.color_secondary} onChange={set('color_secondary')}
          placeholder="#1A2A3A" />
        <Field label="Accent color"
          value={form.color_accent} onChange={set('color_accent')}
          placeholder="#9DB39C" />
        <Field label="Brandbook URL"
          value={form.brandbook_url} onChange={set('brandbook_url')}
          placeholder="https://..." hint="Notion / PDF / Drive link to your brand guidelines." />
        <Textarea2 label="Brandbook notes"
          value={form.brandbook_notes} onChange={set('brandbook_notes')}
          rows={4}
          hint="Anything an image generator or designer should know — typography rules, photo style, what to avoid." />
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
        title="AI tone modifiers"
        description="Per-tone prompt fragments injected when generating content. Use {display_name} and {activity_context} as placeholders — they'll be replaced with this workspace's values at render time. Leave a tone blank to skip its modifier entirely."
      >
        <Textarea2 label="Active & Driven"
          value={form.tone_active} onChange={set('tone_active')} rows={6}
          hint="Used when the author picks the 'Active & Driven' tone." />
        <Textarea2 label="Clinical & In-Depth"
          value={form.tone_clinical} onChange={set('tone_clinical')} rows={6}
          hint="Used when the author picks the 'Clinical & In-Depth' tone." />
        <Textarea2 label="Warm & Reassuring"
          value={form.tone_warm} onChange={set('tone_warm')} rows={6}
          hint="Used when the author picks the 'Warm & Reassuring' tone." />
        <Textarea2 label="Smart Default"
          value={form.tone_smart} onChange={set('tone_smart')} rows={6}
          hint="Used when the author picks 'Smart Default' or no tone." />
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

      <Separator />

      <Section
        title="AI paradigm content (advanced)"
        description="Structured prompt context — patient/audience archetypes, the per-condition interview-context bank, and the topic-suggestions list shown on the Dashboard. Edit as JSON. Invalid JSON blocks save and shows the parse error inline. Leave empty to skip injection."
      >
        <Textarea2 label="Patient / audience context"
          value={form.patient_context_json} onChange={set('patient_context_json')}
          rows={14}
          hint="Shape: { summaryBlurb, primaryAvatar, prototypes[], priorProviderPainPoints[], staffProfiles[] }" />
        <Textarea2 label="Interview context (PNW condition bank)"
          value={form.interview_context_json} onChange={set('interview_context_json')}
          rows={18}
          hint="Shape: { conditions: { [key]: { audienceProfile, audienceStakes, regionalAngles[], interviewTopics[], chronicRelevant } }, keywordAliases, fallback }" />
        <Textarea2 label="Topic suggestions"
          value={form.topic_suggestions_json} onChange={set('topic_suggestions_json')}
          rows={14}
          hint="Shape: array of { topic, category, priority: 'high'|'medium'|'low', keywords[], pnwNote }" />
      </Section>

      {hasPublishCapability(ws) && (
        <>
          <Separator />
          <CredentialsSection getToken={getToken} />
        </>
      )}

      <Separator />
      <DangerZone workspace={ws} getToken={getToken} />
    </div>
  )
}

// Destructive actions live at the bottom of the form behind a typed-confirm
// gate (paste the workspace's slug). The same check runs server-side in
// api/workspace/danger.js — the slug is the gate not the display name
// because it's the irreversible primary key bound to the subdomain.
//
// archive is the only action wired today. rename / transfer / hard-delete
// each require additional server plumbing (Vercel domain swap, Clerk org
// ownership API, cross-table cascade) and are signposted as "contact the
// platform team" below.
function DangerZone({ workspace, getToken }) {
  const [confirmText, setConfirmText]   = useState('')
  const [archiving, setArchiving]       = useState(false)
  const [error, setError]               = useState(null)

  const slug = workspace?.slug || ''
  const matches = confirmText.trim().toLowerCase() === slug.toLowerCase() && slug.length > 0

  async function handleArchive() {
    if (!matches || archiving) return
    if (!confirm(`Archive "${workspace?.display_name || slug}"? This suspends the workspace immediately. Members lose access on their next request. Restoring requires database access.`)) return
    setArchiving(true)
    setError(null)
    try {
      const token = await getToken({ skipCache: true })
      const r = await fetch('/api/workspace/danger', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ action: 'archive', confirm_slug: confirmText.trim() }),
      })
      if (!r.ok) {
        const body = await r.json().catch(() => ({}))
        setError(body?.error || `archive-failed (${r.status})`)
        setArchiving(false)
        return
      }
      // Workspace is now archived. workspaceContext rejects status !== 'active',
      // so any further API call will 404. Sign the user out + bounce to the
      // apex so they don't sit on a half-broken session.
      try { await window.Clerk?.signOut?.() } catch {}
      window.location.href = 'https://narraterx.ai'
    } catch (e) {
      setError(e?.message || 'network-error')
      setArchiving(false)
    }
  }

  return (
    <Section title="Danger zone" description="Destructive actions. Read carefully — these affect every member of the workspace.">
      <div className="rounded-lg border-2 border-destructive/30 bg-destructive/5 p-4 space-y-3">
        <div className="flex items-start gap-2">
          <AlertCircle className="h-4 w-4 text-destructive shrink-0 mt-0.5" aria-hidden="true" />
          <div>
            <p className="text-sm font-semibold text-destructive">Archive workspace</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Suspends this workspace immediately. All members lose access — the subdomain stops resolving and every API call returns 404. Content, media, and credentials stay in storage so the workspace can be restored manually via the database.
            </p>
            <ul className="text-[11px] text-muted-foreground list-disc pl-4 mt-1.5 space-y-0.5">
              <li>Published posts on external channels (WordPress / Astro / Buffer) are <strong>not</strong> taken down.</li>
              <li>Cron jobs that reference this workspace start no-op'ing.</li>
              <li>Your Clerk Organization is not deleted; members can still sign in elsewhere.</li>
            </ul>
          </div>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs font-medium">
            To confirm, type the workspace slug: <code className="text-foreground bg-muted px-1 py-0.5 rounded">{slug}</code>
          </Label>
          <Input
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            placeholder={slug}
            disabled={archiving}
            autoComplete="off"
            className="text-sm"
          />
          {error && (
            <p className="text-xs text-destructive flex items-center gap-1.5">
              <AlertCircle className="h-3.5 w-3.5" />
              {error === 'confirm-slug-mismatch'
                ? "The slug you typed doesn't match. Copy the value above exactly."
                : error}
            </p>
          )}
          <Button
            variant="destructive"
            size="sm"
            onClick={handleArchive}
            disabled={!matches || archiving}
          >
            {archiving && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />}
            Archive this workspace
          </Button>
        </div>
      </div>

      <p className="text-[11px] text-muted-foreground">
        Rename, transfer ownership, and hard delete are not available in-app yet — each requires substantial server work (Vercel domain re-register, Clerk org-ownership swap, cross-table cascade + blob cleanup). Contact the platform team (drq@narraterx.ai) for any of these.
      </p>
    </Section>
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

// Asset field that opens the Media Hub picker. Uploads flow through
// /api/media/upload like any Media Hub upload — logos are tagged, searchable,
// and never orphaned. We store the rendered URL on the workspace; the asset
// row stays in media_assets as the source of truth.
function LogoField({ label, value, onChange, hint }) {
  const [pickerOpen, setPickerOpen] = useState(false)
  return (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      <div className="flex items-start gap-3">
        {value ? (
          <div className="h-16 w-16 rounded border border-input bg-muted/30 overflow-hidden shrink-0 flex items-center justify-center">
            <img src={value} alt={label} className="h-full w-full object-contain" />
          </div>
        ) : (
          <div className="h-16 w-16 rounded border border-dashed border-input bg-muted/20 flex items-center justify-center shrink-0">
            <ImageIcon className="h-5 w-5 text-muted-foreground/60" />
          </div>
        )}
        <div className="flex-1 min-w-0 space-y-1">
          <div className="flex items-center gap-2">
            <Button type="button" size="sm" variant="outline" onClick={() => setPickerOpen(true)}>
              <Upload className="h-3.5 w-3.5 mr-1.5" />
              {value ? 'Replace' : 'Upload'}
            </Button>
            {value && (
              <Button type="button" size="sm" variant="ghost" onClick={() => onChange('')}>
                Remove
              </Button>
            )}
          </div>
          {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
          {value && (
            <p className="text-[11px] text-muted-foreground font-mono truncate" title={value}>{value}</p>
          )}
        </div>
      </div>
      {pickerOpen && (
        <MediaPicker
          onClose={() => setPickerOpen(false)}
          onSelect={(asset) => {
            onChange(asset.url)
            setPickerOpen(false)
          }}
        />
      )}
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

// ── Publishing credentials ────────────────────────────────────────────────────

const CREDENTIAL_SERVICES = [
  {
    id: 'buffer',
    label: 'Buffer',
    description: 'Buffer access token — the universal social path. Routes posts to every connected channel in your Buffer org (Instagram, Facebook, LinkedIn, X/Twitter, Pinterest, TikTok, YouTube Shorts, Threads, Bluesky, Mastodon).',
    secretLabel: 'Access token',
    fields: [],
  },
  // Facebook moved to Buffer 2026-05-10 and GBP followed 2026-05-11 — no
  // separate credential cards. Connect each FB Page / GBP listing as a Channel
  // in your Buffer organization; the existing Buffer token gains posting
  // permission automatically. Per-location Buffer GBP channel IDs live on
  // workspace_locations rows (Locations panel above).
  {
    id: 'wordpress',
    label: 'WordPress',
    description: 'WordPress REST publishing (equine). site_url must include /wp-json/.',
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

function CredentialsSection({ getToken }) {
  const [services, setServices] = useState(null) // null=loading, array of configured rows
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

  useEffect(() => { reload() /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [])

  return (
    <Section
      title="Publishing credentials"
      description="These tokens are stored encrypted (AES-256-GCM) and decrypted only at publish time. Each value applies to this workspace only. Secrets are write-only — they never come back on read."
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
            <span className="text-[10px] uppercase tracking-wide bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300 px-1.5 py-0.5 rounded">
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

// ── Locations ─────────────────────────────────────────────────────────────────

function LocationsPanel({ getToken, onSyncWorkspace }) {
  const [locations, setLocations] = useState(null) // null=loading
  const [error, setError] = useState(null)
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState(emptyLocationDraft())

  async function reload() {
    try {
      const r = await fetch('/api/workspace/locations', {
        headers: { Authorization: `Bearer ${await getToken({ skipCache: true })}` },
      })
      if (!r.ok) {
        setLocations([])
        setError(r.status === 403 ? 'forbidden' : `load-failed (${r.status})`)
        return
      }
      const data = await r.json()
      setLocations(Array.isArray(data?.locations) ? data.locations : [])
      setError(null)
    } catch {
      setLocations([])
      setError('network-error')
    }
  }

  useEffect(() => { reload() /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [])

  async function handleCreate() {
    if (!draft.city.trim()) {
      setError('city-required')
      return
    }
    setError(null)
    try {
      const r = await fetch('/api/workspace/locations', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${await getToken({ skipCache: true })}`,
        },
        body: JSON.stringify({
          ...draft,
          // First location ever inserted? Make it primary so umbrella stays in sync.
          is_primary: locations && locations.length === 0,
        }),
      })
      if (!r.ok) {
        const e = await r.json().catch(() => ({}))
        setError(e.error || 'save-failed')
        return
      }
      setDraft(emptyLocationDraft())
      setAdding(false)
      await reload()
      onSyncWorkspace?.()
    } catch {
      setError('network-error')
    }
  }

  if (locations === null) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading locations…
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {error && (
        <div className="text-xs text-destructive flex items-center gap-1">
          <AlertCircle className="h-3.5 w-3.5" />{error}
        </div>
      )}
      {locations.length === 0 && (
        <p className="text-xs text-muted-foreground">No locations yet — add the first one below.</p>
      )}
      <div className="space-y-2">
        {locations.map(loc => (
          <LocationRow
            key={loc.id}
            location={loc}
            getToken={getToken}
            onChange={async () => { await reload(); onSyncWorkspace?.() }}
            isOnlyLocation={locations.length === 1}
          />
        ))}
      </div>

      {adding ? (
        <div className="rounded-md border border-input p-3 space-y-3">
          <LocationFields draft={draft} setDraft={setDraft} />
          <div className="flex items-center gap-2 justify-end">
            <Button size="sm" variant="ghost" onClick={() => { setAdding(false); setDraft(emptyLocationDraft()) }}>
              Cancel
            </Button>
            <Button size="sm" onClick={handleCreate}>Add location</Button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="inline-flex items-center gap-1 text-xs text-orange-600 hover:underline"
        >
          <Plus className="h-3.5 w-3.5" /> Add another location
        </button>
      )}
    </div>
  )
}

function emptyLocationDraft() {
  return {
    label: '', city: '', region: '',
    location_keyword: '', location_hashtag: '',
    visit_url: '', gbp_location_id: '',
  }
}

function LocationRow({ location, getToken, onChange, isOnlyLocation }) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState({
    label: location.label || '',
    city: location.city || '',
    region: location.region || '',
    location_keyword: location.location_keyword || '',
    location_hashtag: location.location_hashtag || '',
    visit_url: location.visit_url || '',
  })
  const [saving, setSaving] = useState(false)
  const [saved, setSaved]   = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    setDraft({
      label: location.label || '',
      city: location.city || '',
      region: location.region || '',
      location_keyword: location.location_keyword || '',
      location_hashtag: location.location_hashtag || '',
      visit_url: location.visit_url || '',
      gbp_location_id: location.gbp_location_id || '',
    })
  }, [location])

  async function handleSave() {
    setSaving(true)
    setError(null)
    setSaved(false)
    try {
      const r = await fetch(`/api/workspace/locations?id=${encodeURIComponent(location.id)}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${await getToken({ skipCache: true })}`,
        },
        body: JSON.stringify(draft),
      })
      if (!r.ok) {
        const e = await r.json().catch(() => ({}))
        setError(e.error || 'save-failed')
      } else {
        onChange?.()
        setSaved(true)
        setTimeout(() => setSaved(false), 3000)
      }
    } catch {
      setError('network-error')
    } finally {
      setSaving(false)
    }
  }

  async function handleMakePrimary() {
    setSaving(true)
    setError(null)
    try {
      const r = await fetch(`/api/workspace/locations?id=${encodeURIComponent(location.id)}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${await getToken({ skipCache: true })}`,
        },
        body: JSON.stringify({ is_primary: true }),
      })
      if (!r.ok) {
        const e = await r.json().catch(() => ({}))
        setError(e.error || 'save-failed')
      } else {
        onChange?.()
      }
    } catch {
      setError('network-error')
    } finally {
      setSaving(false)
    }
  }

  async function handleArchive() {
    if (location.is_primary) return
    if (!confirm(`Archive "${location.label || location.city}"? This won't delete past content tagged to it.`)) return
    setSaving(true)
    setError(null)
    try {
      const r = await fetch(`/api/workspace/locations?id=${encodeURIComponent(location.id)}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${await getToken({ skipCache: true })}` },
      })
      if (!r.ok) {
        const e = await r.json().catch(() => ({}))
        setError(e.error || 'archive-failed')
      } else {
        onChange?.()
      }
    } catch {
      setError('network-error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="rounded-md border border-input">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between gap-2 p-3 text-left hover:bg-accent/30"
      >
        <div className="flex items-center gap-2 min-w-0">
          {open ? <ChevronDown className="h-4 w-4 shrink-0" /> : <ChevronRight className="h-4 w-4 shrink-0" />}
          <div className="text-sm font-medium">
            {location.label || location.city}
          </div>
          {location.is_primary && (
            <span className="text-[10px] uppercase tracking-wide bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300 px-1.5 py-0.5 rounded inline-flex items-center gap-0.5">
              <Star className="h-2.5 w-2.5" /> Primary
            </span>
          )}
        </div>
        <div className="text-[11px] text-muted-foreground truncate">
          {[location.city, location.region].filter(Boolean).join(', ')}
          {location.location_hashtag ? ` · ${location.location_hashtag}` : ''}
        </div>
      </button>
      {open && (
        <div className="border-t border-input p-3 space-y-3">
          <LocationFields draft={draft} setDraft={setDraft} />
          <div className="flex items-center gap-2 justify-end">
            {error && (
              <span className="text-xs text-destructive flex items-center gap-1">
                <AlertCircle className="h-3.5 w-3.5" />{error}
              </span>
            )}
            {!location.is_primary && (
              <Button size="sm" variant="ghost" onClick={handleMakePrimary} disabled={saving}>
                <Star className="h-3.5 w-3.5 mr-1" /> Make primary
              </Button>
            )}
            {!location.is_primary && !isOnlyLocation && (
              <Button size="sm" variant="ghost" onClick={handleArchive} disabled={saving}>
                <Trash2 className="h-3.5 w-3.5 mr-1" /> Archive
              </Button>
            )}
            <Button size="sm" onClick={handleSave} disabled={saving}>
              {saving
                ? <><Loader2 className="h-4 w-4 animate-spin mr-1.5" />Save</>
                : saved
                  ? <><CheckCircle2 className="h-3.5 w-3.5 mr-1.5" />Saved</>
                  : 'Save'}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

function LocationFields({ draft, setDraft }) {
  function set(k) { return v => setDraft(d => ({ ...d, [k]: v })) }
  return (
    <>
      <div className="grid grid-cols-12 gap-2">
        <div className="col-span-5 space-y-1">
          <Label className="text-xs">City</Label>
          <Input value={draft.city} onChange={e => set('city')(e.target.value)} placeholder="Portland" className="text-sm" />
        </div>
        <div className="col-span-3 space-y-1">
          <Label className="text-xs">State</Label>
          <Input value={draft.region} onChange={e => set('region')(e.target.value)} placeholder="OR" className="text-sm" />
        </div>
        <div className="col-span-4 space-y-1">
          <Label className="text-xs">Label</Label>
          <Input value={draft.label} onChange={e => set('label')(e.target.value)} placeholder="optional" className="text-sm" />
        </div>
      </div>
      <div className="grid grid-cols-12 gap-2">
        <div className="col-span-6 space-y-1">
          <Label className="text-xs">Location keyword</Label>
          <Input
            value={draft.location_keyword}
            onChange={e => set('location_keyword')(e.target.value)}
            placeholder="Portland"
            className="text-sm"
          />
          <p className="text-[10px] text-muted-foreground">Used in copy and 'near me' SEO.</p>
        </div>
        <div className="col-span-6 space-y-1">
          <Label className="text-xs">Location hashtag</Label>
          <Input
            value={draft.location_hashtag}
            onChange={e => set('location_hashtag')(e.target.value)}
            placeholder="#YourCity"
            className="text-sm"
          />
        </div>
      </div>
      <div className="space-y-1">
        <Label className="text-xs">Visit URL</Label>
        <Input
          value={draft.visit_url}
          onChange={e => set('visit_url')(e.target.value)}
          placeholder="https://yourpractice.com/visit/portland"
          className="text-sm"
        />
      </div>
      <div className="space-y-1">
        <Label className="text-xs">Buffer GBP channel ID</Label>
        <Input
          value={draft.gbp_location_id}
          onChange={e => set('gbp_location_id')(e.target.value)}
          placeholder="e.g. 6612a8c7d4e3f2b1a09f8765"
          className="text-sm font-mono"
        />
        <p className="text-[10px] text-muted-foreground">
          Buffer profile ID for this location's Google Business listing. Find it
          at <a className="underline" href="https://publish.buffer.com/" target="_blank" rel="noreferrer">publish.buffer.com</a> →
          select the GBP channel → copy the ID from the URL
          (<code>publish.buffer.com/profile/&lt;id&gt;/...</code>), or call
          <code> GET https://api.bufferapp.com/1/profiles.json?access_token=&lt;token&gt;</code> and
          pick the entry whose <code>service</code> is googlebusiness.
          Leave blank if this location has no GBP listing.
        </p>
      </div>
    </>
  )
}
