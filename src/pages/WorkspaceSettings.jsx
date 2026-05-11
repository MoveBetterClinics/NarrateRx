import { useState, useEffect } from 'react'
import { Navigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '@clerk/clerk-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Separator } from '@/components/ui/separator'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Loader2, CheckCircle2, AlertCircle, ChevronDown, ChevronRight, Trash2, Plus, Star } from 'lucide-react'
import { useUserRole } from '@/lib/useUserRole'
import { OUTPUT_CHANNELS } from '@/lib/outputChannels'
import { useDocumentTitle } from '@/lib/useDocumentTitle'
import { ConfirmDialog } from '@/components/ui/alert-dialog'
import { useUnsavedChanges } from '@/lib/useUnsavedChanges'
import { useSaveShortcut } from '@/lib/useSaveShortcut'
import { useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '@/lib/queries'

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

// Per-section save configs. Each section owns:
//   fields[]   — the form keys this section's inputs write to, used for the
//                section-level dirty check (strict-equal compare against
//                pristineForm).
//   buildPatch — produces the subset of the workspace PATCH body for just
//                this section. Matches the nested shape (social.*, logo.*,
//                colors.*, brandbook.*, tone_modifiers.*) the server expects.
//                For JSON sections, parsing happens inside buildPatch and
//                throws on bad JSON so the SectionSaveBar can surface it.
//
// The page-level "Save all changes" button continues to PATCH everything in
// one shot via the existing formToPatch + handleSave pair. Section saves
// only ever PATCH their own keys.
const SECTION_CONFIGS = {
  identity: {
    title: 'Identity',
    fields: ['display_name', 'tagline', 'sign_in_blurb', 'app_name'],
    buildPatch: (f) => ({
      display_name:  f.display_name,
      tagline:       f.tagline,
      sign_in_blurb: f.sign_in_blurb,
      app_name:      f.app_name,
    }),
  },
  webPresence: {
    title: 'Web presence',
    fields: ['website', 'website_hostname', 'location', 'region', 'region_short', 'link_preview_blurb'],
    buildPatch: (f) => ({
      website:            f.website,
      website_hostname:   f.website_hostname,
      location:           f.location,
      region:             f.region,
      region_short:       f.region_short,
      link_preview_blurb: f.link_preview_blurb,
    }),
  },
  social: {
    title: 'Social handles',
    fields: ['social_instagram', 'social_facebook'],
    buildPatch: (f) => ({
      social: { instagram: f.social_instagram, facebook: f.social_facebook },
    }),
  },
  brandAssets: {
    title: 'Brand assets',
    fields: ['logo_main', 'logo_icon', 'color_primary', 'color_secondary', 'color_accent', 'brandbook_url', 'brandbook_notes'],
    buildPatch: (f) => ({
      logo:      { main: f.logo_main || null, icon: f.logo_icon || null },
      colors:    { primary: f.color_primary || null, secondary: f.color_secondary || null, accent: f.color_accent || null },
      brandbook: { url: f.brandbook_url || null, notes: f.brandbook_notes || null },
    }),
  },
  content: {
    title: 'Content',
    fields: ['internal_links_markdown', 'signature_system_name', 'signature_system_url', 'pinterest_boards', 'location_keyword', 'location_hashtag', 'brand_hashtag', 'spoken_url'],
    buildPatch: (f) => ({
      internal_links_markdown: f.internal_links_markdown,
      signature_system_name:   f.signature_system_name || null,
      signature_system_url:    f.signature_system_url  || null,
      pinterest_boards:        f.pinterest_boards,
      location_keyword:        f.location_keyword,
      location_hashtag:        f.location_hashtag,
      brand_hashtag:           f.brand_hashtag,
      spoken_url:              f.spoken_url,
    }),
  },
  voice: {
    title: 'AI voice context',
    fields: ['clinic_context', 'audience_short', 'audience_description', 'activity_context', 'brand_voice', 'booking_url'],
    buildPatch: (f) => ({
      clinic_context:       f.clinic_context,
      audience_short:       f.audience_short,
      audience_description: f.audience_description,
      activity_context:     f.activity_context,
      brand_voice:          f.brand_voice,
      booking_url:          f.booking_url,
    }),
  },
  tones: {
    title: 'AI tone modifiers',
    fields: ['tone_active', 'tone_clinical', 'tone_warm', 'tone_smart'],
    buildPatch: (f) => ({
      tone_modifiers: {
        active:   f.tone_active   ?? '',
        clinical: f.tone_clinical ?? '',
        warm:     f.tone_warm     ?? '',
        smart:    f.tone_smart    ?? '',
      },
    }),
  },
  paradigm: {
    title: 'AI paradigm content',
    fields: ['patient_context_json', 'interview_context_json', 'topic_suggestions_json'],
    buildPatch: (f) => {
      // Surface inline parse errors via thrown Error — SectionSaveBar catches
      // and renders them next to the failing section, the same way the
      // page-level handleSave used to.
      const pc = tryParseJson(f.patient_context_json,    {})
      const ic = tryParseJson(f.interview_context_json,  {})
      const ts = tryParseJson(f.topic_suggestions_json,  [])
      if (!pc.ok) throw new Error(`Patient context JSON: ${pc.error}`)
      if (!ic.ok) throw new Error(`Interview context JSON: ${ic.error}`)
      if (!ts.ok) throw new Error(`Topic suggestions JSON: ${ts.error}`)
      return {
        patient_context:   pc.value,
        interview_context: ic.value,
        topic_suggestions: ts.value,
      }
    },
  },
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
  useDocumentTitle('Workspace settings')
  const { getToken } = useAuth()
  const qc = useQueryClient()

  // Active tab is driven by ?tab= so deep links open the right section and
  // the browser back button restores it. Allowlist keeps unknown values
  // from rendering blank when someone hand-edits the URL.
  const ALLOWED_TABS = ['general', 'brand', 'voice', 'locations', 'channels', 'danger']
  const [searchParams, setSearchParams] = useSearchParams()
  const tabFromUrl = searchParams.get('tab')
  const activeTab = ALLOWED_TABS.includes(tabFromUrl) ? tabFromUrl : 'general'
  function setActiveTab(value) {
    const next = new URLSearchParams(searchParams)
    if (value === 'general') next.delete('tab')        // keep default URL clean
    else                     next.set('tab', value)
    // replace: tab switches shouldn't pile up in browser history
    setSearchParams(next, { replace: true })
  }
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
  // threshold where stringify is a perf concern, and it runs only when
  // either side changes.
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
        // Invalidate the shared workspace query so the rest of the app
        // (Layout chrome, NewInterview suggestions, ContentHub topic
        // filter, etc.) picks up the new brand/voice/topics immediately.
        qc.invalidateQueries({ queryKey: queryKeys.workspace.me })
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
          <Button size="sm" variant={isDirty ? 'default' : 'outline'} onClick={handleSave} disabled={saving || !isDirty}>
            {saving && <Loader2 className="h-4 w-4 animate-spin mr-1.5" />}
            Save all changes
          </Button>
        </div>
      </div>

      {/* Per-section save bundle. Each Section inside General / Brand / Voice
          gets its own "Save section" button keyed by the SECTION_CONFIGS
          map; the top-of-page "Save all changes" stays as a one-click
          fallback that PATCHes every dirty field across every tab.
          Locations + Channels manage their own per-row/per-card saves. */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid grid-cols-6 w-full max-w-2xl">
          <TabsTrigger value="general">General</TabsTrigger>
          <TabsTrigger value="brand">Brand</TabsTrigger>
          <TabsTrigger value="voice">Voice</TabsTrigger>
          <TabsTrigger value="locations">Locations</TabsTrigger>
          <TabsTrigger value="channels">Channels</TabsTrigger>
          <TabsTrigger value="danger" className="text-destructive data-[state=active]:text-destructive">Danger</TabsTrigger>
        </TabsList>

      <TabsContent value="general" className="space-y-6 mt-6">
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
          <SectionSaveBar config={SECTION_CONFIGS.identity} form={form} pristineForm={pristineForm} setPristineForm={setPristineForm} setWs={setWs} getToken={getToken} qc={qc} />
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
          <SectionSaveBar config={SECTION_CONFIGS.webPresence} form={form} pristineForm={pristineForm} setPristineForm={setPristineForm} setWs={setWs} getToken={getToken} qc={qc} />
        </Section>

        <Separator />

        <Section title="Social handles">
          <Field label="Instagram handle"
            value={form.social_instagram} onChange={set('social_instagram')} placeholder="yourhandle" />
          <Field label="Facebook handle"
            value={form.social_facebook} onChange={set('social_facebook')} placeholder="yourpage" />
          <SectionSaveBar config={SECTION_CONFIGS.social} form={form} pristineForm={pristineForm} setPristineForm={setPristineForm} setWs={setWs} getToken={getToken} qc={qc} />
        </Section>
      </TabsContent>

      <TabsContent value="brand" className="space-y-6 mt-6">
        <Section
          title="Brand assets"
          description="Logos, colors, and brandbook reference. Used for link previews, social avatars, and image generation. Paste hosted URLs (Vercel Blob, Drive share, etc.)."
        >
          <Field label="Logo URL (main)"
            value={form.logo_main} onChange={set('logo_main')}
            placeholder="https://..." hint="Wordmark / horizontal logo for headers and link previews." />
          <Field label="Logo URL (icon)"
            value={form.logo_icon} onChange={set('logo_icon')}
            placeholder="https://..." hint="Square mark for social avatars and favicons." />
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
          <SectionSaveBar config={SECTION_CONFIGS.brandAssets} form={form} pristineForm={pristineForm} setPristineForm={setPristineForm} setWs={setWs} getToken={getToken} qc={qc} />
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
          <SectionSaveBar config={SECTION_CONFIGS.content} form={form} pristineForm={pristineForm} setPristineForm={setPristineForm} setWs={setWs} getToken={getToken} qc={qc} />
        </Section>
      </TabsContent>

      <TabsContent value="voice" className="space-y-6 mt-6">
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
          <SectionSaveBar config={SECTION_CONFIGS.voice} form={form} pristineForm={pristineForm} setPristineForm={setPristineForm} setWs={setWs} getToken={getToken} qc={qc} />
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
          <SectionSaveBar config={SECTION_CONFIGS.tones} form={form} pristineForm={pristineForm} setPristineForm={setPristineForm} setWs={setWs} getToken={getToken} qc={qc} />
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
          <SectionSaveBar config={SECTION_CONFIGS.paradigm} form={form} pristineForm={pristineForm} setPristineForm={setPristineForm} setWs={setWs} getToken={getToken} qc={qc} />
        </Section>
      </TabsContent>

      <TabsContent value="locations" className="space-y-6 mt-6">
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
                  qc.invalidateQueries({ queryKey: queryKeys.workspace.me })
                }
              })
              .catch(() => {})
          }} />
        </Section>
      </TabsContent>

      <TabsContent value="channels" className="space-y-6 mt-6">
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

        {hasPublishCapability(ws) && (
          <>
            <Separator />
            <CredentialsSection getToken={getToken} />
          </>
        )}
      </TabsContent>

      <TabsContent value="danger" className="space-y-6 mt-6">
        <DangerZone workspace={ws} getToken={getToken} />
      </TabsContent>
      </Tabs>
    </div>
  )
}

// Destructive actions live behind their own tab so they can't be hit
// accidentally while scrolling through the form. Each action is gated by a
// typed-confirm pattern (paste the workspace's slug) — the same check runs
// server-side in api/workspace/danger.js. The slug is the gate not the
// display name because it's the irreversible primary key in the routing
// system, and what's bound to the subdomain.
function DangerZone({ workspace, getToken }) {
  const [confirmText, setConfirmText]   = useState('')
  const [confirmOpen, setConfirmOpen]   = useState(false)
  const [archiving, setArchiving]       = useState(false)
  const [error, setError]               = useState(null)

  const slug = workspace?.slug || ''
  const matches = confirmText.trim().toLowerCase() === slug.toLowerCase() && slug.length > 0

  async function handleArchive() {
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
      // Workspace is now archived. The current subdomain is no longer active
      // — workspaceContext rejects status !== 'active', so any further API
      // call will 404. Sign the user out + bounce to the apex so they don't
      // sit on a half-broken session.
      try { await window.Clerk?.signOut?.() } catch {}
      window.location.href = 'https://narraterx.ai'
    } catch (e) {
      setError(e?.message || 'network-error')
      setArchiving(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="rounded-lg border-2 border-destructive/30 bg-destructive/5 p-5 space-y-4">
        <div className="flex items-start gap-3">
          <AlertCircle className="h-5 w-5 text-destructive shrink-0 mt-0.5" aria-hidden="true" />
          <div className="space-y-1">
            <h2 className="text-base font-semibold text-destructive">Archive workspace</h2>
            <p className="text-sm text-muted-foreground">
              Archiving suspends this workspace immediately. All members lose access — the
              subdomain stops resolving and every API call returns 404. Content, media, and
              credentials stay in storage so the workspace can be restored manually via the
              database (no in-app restore yet).
            </p>
            <ul className="text-xs text-muted-foreground list-disc pl-5 mt-2 space-y-0.5">
              <li>Published posts on external channels (WordPress, Astro, Buffer) are <strong>not</strong> taken down.</li>
              <li>Scheduled cron jobs that reference this workspace will start no-op'ing.</li>
              <li>Your Clerk Organization is not deleted; members can still sign in elsewhere.</li>
            </ul>
          </div>
        </div>

        <Separator />

        <div className="space-y-2">
          <Label htmlFor="archive-confirm" className="text-xs font-medium">
            To confirm, type the workspace slug: <code className="text-foreground bg-muted px-1 py-0.5 rounded">{slug}</code>
          </Label>
          <Input
            id="archive-confirm"
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            placeholder={slug}
            disabled={archiving}
            autoComplete="off"
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
            onClick={() => setConfirmOpen(true)}
            disabled={!matches || archiving}
          >
            {archiving && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />}
            Archive this workspace
          </Button>
        </div>
      </div>

      <div className="rounded-lg border bg-muted/30 p-5 space-y-1">
        <p className="text-sm font-medium">Rename, transfer, hard delete</p>
        <p className="text-xs text-muted-foreground">
          Not available in-app yet. Rename requires re-registering the subdomain in
          Vercel + a redirect plan; transfer needs a Clerk org-ownership swap; hard
          delete cascades across blob storage and audit logs. Contact the platform team
          (drq@narraterx.ai) for any of these.
        </p>
      </div>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={`Archive "${workspace?.display_name || slug}"?`}
        description="This suspends the workspace immediately. Members lose access on their next request. Restoring requires database access — there's no in-app un-archive yet."
        confirmLabel="Archive workspace"
        onConfirm={handleArchive}
        loading={archiving}
      />
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

// Per-section save button + status. Mounted at the bottom of each Section in
// the General/Brand/Voice tabs (Locations + Channels manage their own).
//
//   - Reads the section's owned fields from `form` and compares strict-equal
//     against `pristineForm` for the dirty signal — no JSON.stringify so a
//     same-string typed-then-undone reads as clean.
//   - On Save: builds only the section's patch via config.buildPatch and
//     PATCHes /api/workspace/me with that subset (server's allowlist
//     accepts any subset).
//   - Updates pristineForm for only this section's keys on success, so
//     other unsaved sections stay marked dirty.
//   - Invalidates queryKeys.workspace.me so chrome (Layout brand name etc.)
//     picks up the change immediately.
function SectionSaveBar({ config, form, pristineForm, setPristineForm, setWs, getToken, qc }) {
  const [saving, setSaving] = useState(false)
  const [saved, setSaved]   = useState(false)
  const [error, setError]   = useState(null)

  const isDirty = !!form && !!pristineForm && config.fields.some(
    (k) => (form[k] ?? '') !== (pristineForm[k] ?? ''),
  )

  async function handleSectionSave() {
    if (!isDirty || saving) return
    setSaving(true)
    setSaved(false)
    setError(null)
    let patch
    try {
      patch = config.buildPatch(form)
    } catch (e) {
      // Most commonly a JSON parse error from the paradigm section.
      setError(e?.message || 'Could not build save payload')
      setSaving(false)
      return
    }
    try {
      const token = await getToken()
      const r = await fetch('/api/workspace/me', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(patch),
      })
      if (!r.ok) {
        const body = await r.json().catch(() => ({}))
        setError(body?.error || `Save failed (${r.status})`)
      } else {
        const updated = await r.json()
        if (setWs) setWs(updated)
        // Refresh only this section's slice of pristineForm so other
        // dirty sections stay dirty.
        setPristineForm((prev) => {
          if (!prev) return prev
          const next = { ...prev }
          for (const k of config.fields) next[k] = form[k]
          return next
        })
        setSaved(true)
        setTimeout(() => setSaved(false), 2500)
        qc?.invalidateQueries({ queryKey: queryKeys.workspace.me })
      }
    } catch {
      setError('network-error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex items-center justify-end gap-2 pt-1">
      {saved && (
        <span className="text-xs text-green-600 flex items-center gap-1">
          <CheckCircle2 className="h-3.5 w-3.5" />Saved
        </span>
      )}
      {error && (
        <span className="text-xs text-destructive flex items-center gap-1 max-w-md">
          <AlertCircle className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate">{error}</span>
        </span>
      )}
      <Button size="sm" variant="outline" onClick={handleSectionSave} disabled={!isDirty || saving}>
        {saving && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />}
        Save section
      </Button>
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

function emptyConfigFor(service) {
  const out = {}
  for (const f of service.fields) out[f.key] = f.isCsv ? '' : ''
  return out
}

function configFromRow(service, row) {
  const cfg = emptyConfigFor(service)
  if (!row?.config) return cfg
  for (const f of service.fields) {
    const v = row.config[f.key]
    if (f.isCsv) cfg[f.key] = Array.isArray(v) ? v.join(', ') : (v ?? '')
    else cfg[f.key] = v ?? ''
  }
  return cfg
}

function configToPayload(service, cfg) {
  const out = {}
  for (const f of service.fields) {
    const v = cfg[f.key] ?? ''
    if (f.isCsv) {
      out[f.key] = String(v).split(',').map((s) => s.trim()).filter(Boolean)
    } else {
      out[f.key] = String(v).trim()
    }
  }
  return out
}

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
  const [config, setConfig] = useState(() => configFromRow(service, row))
  const [secret, setSecret] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState(null)
  const [removeOpen, setRemoveOpen] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState(null)

  const TESTABLE = new Set(['buffer', 'wordpress', 'astro_github', 'website'])
  const configured = Boolean(row)
  const canTest = configured && TESTABLE.has(service.id)

  async function handleTest() {
    setTesting(true)
    setTestResult(null)
    try {
      const r = await fetch('/api/workspace/credentials/test', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${await getToken({ skipCache: true })}`,
        },
        body: JSON.stringify({ service: service.id }),
      })
      const body = await r.json().catch(() => ({}))
      setTestResult(body?.ok ? { ok: true, info: body.info } : { ok: false, error: body?.error || `Test failed (${r.status})` })
    } catch (e) {
      setTestResult({ ok: false, error: e?.message || 'Network error.' })
    } finally {
      setTesting(false)
    }
  }

  useEffect(() => {
    setConfig(configFromRow(service, row))
  }, [service, row])

  async function handleSave() {
    setSaving(true)
    setError(null)
    setSaved(false)
    try {
      if (!secret) {
        setError('Secret is required')
        setSaving(false)
        return
      }
      const r = await fetch('/api/workspace/credentials', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${await getToken({ skipCache: true })}`,
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

  function handleRemove() {
    if (!configured) return
    setRemoveOpen(true)
  }

  async function confirmRemove() {
    setRemoveOpen(false)
    setSaving(true)
    setError(null)
    try {
      const r = await fetch(`/api/workspace/credentials?service=${encodeURIComponent(service.id)}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${await getToken({ skipCache: true })}` },
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
        <div className="border-t border-input p-3 space-y-3">
          {service.fields.map((f) => (
            <div className="space-y-1" key={f.key}>
              <Label className="text-xs">{f.label}</Label>
              <Input
                value={config[f.key] ?? ''}
                onChange={(e) => setConfig((c) => ({ ...c, [f.key]: e.target.value }))}
                placeholder={f.placeholder}
                className="text-sm"
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
                placeholder={configured ? '•••••• (write-only — paste a new value to rotate)' : 'Paste secret here'}
                className="text-sm font-mono resize-y"
              />
            ) : (
              <Input
                type="password"
                value={secret}
                onChange={(e) => setSecret(e.target.value)}
                placeholder={configured ? '•••••• (write-only — paste a new value to rotate)' : 'Paste secret here'}
                className="text-sm"
              />
            )}
            <p className="text-[11px] text-muted-foreground">
              Secrets never come back on read. To rotate, paste the new value and Save.
            </p>
          </div>
          <div className="flex items-center gap-2 justify-end">
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
            {testResult?.ok && (
              <span className="text-xs text-green-600 flex items-center gap-1">
                <CheckCircle2 className="h-3.5 w-3.5" />
                Verified{testResult.info?.account ? ` · ${testResult.info.account}` : ''}
              </span>
            )}
            {testResult && !testResult.ok && (
              <span className="text-xs text-destructive flex items-start gap-1 max-w-md">
                <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                <span>{testResult.error}</span>
              </span>
            )}
            {canTest && (
              <Button size="sm" variant="ghost" onClick={handleTest} disabled={testing || saving}>
                {testing ? <><Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />Testing…</> : 'Test'}
              </Button>
            )}
            {configured && (
              <Button size="sm" variant="ghost" onClick={handleRemove} disabled={saving}>
                <Trash2 className="h-3.5 w-3.5 mr-1" />Remove
              </Button>
            )}
            <Button size="sm" onClick={handleSave} disabled={saving}>
              {saving && <Loader2 className="h-4 w-4 animate-spin mr-1.5" />}
              Save
            </Button>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={removeOpen}
        onOpenChange={setRemoveOpen}
        title={`Remove ${service.label} credentials?`}
        description="Posts that use this destination will stop working until you reconnect. The stored credential is permanently deleted; you'll need to paste it again to reconnect."
        confirmLabel="Remove credentials"
        onConfirm={confirmRemove}
        loading={saving}
      />
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
  const [archiveOpen, setArchiveOpen] = useState(false)

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

  function handleArchive() {
    if (location.is_primary) return
    setArchiveOpen(true)
  }

  async function confirmArchive() {
    setArchiveOpen(false)
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

      <ConfirmDialog
        open={archiveOpen}
        onOpenChange={setArchiveOpen}
        title={`Archive "${location.label || location.city}"?`}
        description="This won't delete past content tagged to this location — they keep their tag and stay published. New posts won't be able to target this location until it's restored."
        confirmLabel="Archive location"
        onConfirm={confirmArchive}
        loading={saving}
      />
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
