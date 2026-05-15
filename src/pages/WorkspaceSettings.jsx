import { useState, useEffect, useCallback } from 'react'
import { Navigate, Link, useSearchParams } from 'react-router-dom'
import { useAuth } from '@clerk/clerk-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Separator } from '@/components/ui/separator'
import { Loader2, CheckCircle2, AlertCircle, ChevronDown, ChevronRight, Trash2, Plus, Star, Upload, Image as ImageIcon, ArrowRight } from 'lucide-react'
import MediaPicker from '@/components/MediaPicker'
import PricingCards from '@/components/billing/PricingCards'
import { useUserRole } from '@/lib/useUserRole'
import { useUnsavedChanges } from '@/lib/useUnsavedChanges'
import { useSaveShortcut } from '@/lib/useSaveShortcut'
import { useDocumentTitle } from '@/lib/useDocumentTitle'

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
    internal_links_markdown: ws.internal_links_markdown ?? '',
    signature_system_name:   ws.signature_system_name   ?? '',
    signature_system_url:    ws.signature_system_url    ?? '',
    pinterest_boards:        ws.pinterest_boards        ?? '',
    location_keyword:        ws.location_keyword        ?? '',
    location_hashtag:        ws.location_hashtag        ?? '',
    brand_hashtag:           ws.brand_hashtag           ?? '',
    spoken_url:              ws.spoken_url              ?? '',
    logo_main:               ws.logo?.main              ?? '',
    logo_icon:               ws.logo?.icon              ?? '',
    color_primary:           ws.colors?.primary         ?? '',
    color_secondary:         ws.colors?.secondary       ?? '',
    color_accent:            ws.colors?.accent          ?? '',
    brandbook_url:           ws.brandbook?.url          ?? '',
    brandbook_notes:         ws.brandbook?.notes        ?? '',
    patient_context_json:    JSON.stringify(ws.patient_context   ?? {}, null, 2),
    interview_context_json:  JSON.stringify(ws.interview_context ?? {}, null, 2),
    topic_suggestions_json:  JSON.stringify(ws.topic_suggestions ?? [], null, 2),
    skip_review:             !!ws.skip_review,
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
    internal_links_markdown: form.internal_links_markdown,
    signature_system_name:   form.signature_system_name || null,
    signature_system_url:    form.signature_system_url  || null,
    pinterest_boards:        form.pinterest_boards,
    location_keyword:        form.location_keyword,
    location_hashtag:        form.location_hashtag,
    brand_hashtag:           form.brand_hashtag,
    spoken_url:              form.spoken_url,
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
    patient_context:   form._parsed_patient_context,
    interview_context: form._parsed_interview_context,
    topic_suggestions: form._parsed_topic_suggestions,
    skip_review:       !!form.skip_review,
  }
}

export default function WorkspaceSettings() {
  useDocumentTitle('Settings — Workspace')
  const { getToken } = useAuth()
  const { role, isLoading: roleLoading } = useUserRole()
  const [searchParams, setSearchParams] = useSearchParams()
  const [ws, setWs]       = useState(undefined) // undefined=loading, null=no-context, object=loaded
  const [form, setForm]   = useState(null)
  const [pristineForm, setPristineForm] = useState(null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved]   = useState(false)
  const [error, setError]   = useState(null)
  const [billingToast, setBillingToast] = useState(null) // 'success' | 'cancelled' | null

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

  // Handle return from Stripe checkout: ?billing=success or ?billing=cancelled.
  useEffect(() => {
    const billing = searchParams.get('billing')
    if (billing === 'success' || billing === 'cancelled') {
      setBillingToast(billing)
      // Remove the param from the URL without a page reload.
      const next = new URLSearchParams(searchParams)
      next.delete('billing')
      setSearchParams(next, { replace: true })
      // Auto-dismiss after 5s.
      const t = setTimeout(() => setBillingToast(null), 5000)
      return () => clearTimeout(t)
    }
  }, [searchParams, setSearchParams])

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
      <div className="max-w-3xl mx-auto py-16 text-center space-y-2">
        <p className="text-muted-foreground text-sm">
          Workspace settings are only available on the shared NarrateRx deployment
          (<code className="font-mono text-xs">*.narraterx.ai</code>).
        </p>
      </div>
    )
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
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
          value={form.website} onChange={set('website')} placeholder="https://..." type="url" autoComplete="url" />
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
          placeholder="https://..." hint="Notion / PDF / Drive link to your brand guidelines." type="url" autoComplete="off" />
        <Textarea2 label="Brandbook notes"
          value={form.brandbook_notes} onChange={set('brandbook_notes')}
          rows={4}
          hint="Anything an image generator or designer should know — typography rules, photo style, what to avoid." />
      </Section>

      <Separator />

      {/* Voice context and tone modifiers moved to the Bernard & voice sub-page */}
      <SubpageLink
        to="/settings/workspace/voice"
        title="Bernard & voice"
        description="AI voice context, brand voice, audience, booking URL, and per-tone prompt modifiers."
      />

      <Separator />

      {/* Output channels and credentials moved to the Channels sub-page */}
      <SubpageLink
        to="/settings/workspace/channels"
        title="Output channels"
        description="Choose which channels this workspace generates content for, and manage publishing credentials."
      />

      <Separator />

      <Section
        title="Approval workflow"
        description="When off, drafts route through a reviewer (Send for review → Approve → Publish). Turn this on for single-user workspaces so the editor can publish directly without a second pair of eyes."
      >
        <label className="flex items-start gap-2.5 rounded-md border border-input p-2.5 cursor-pointer hover:bg-accent/30">
          <input
            type="checkbox"
            checked={!!form.skip_review}
            onChange={(e) => setForm((f) => ({ ...f, skip_review: e.target.checked }))}
            className="mt-0.5"
          />
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium leading-tight">Skip review step</div>
            <div className="text-[11px] text-muted-foreground mt-0.5">
              Editors can publish directly from a draft. No reviewer approval required.
            </div>
          </div>
        </label>
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
          hint="Shape: array of { topic, category, priority: 'high'|'medium'|'low', keywords[], pnwNote, prototypes?: string[] }. prototypes is the list of archetype ids (from patient_context.prototypes[].id) this topic primarily serves — empty/missing = all archetypes." />
        <TopicArchetypeEditor
          topicsJson={form.topic_suggestions_json}
          patientContextJson={form.patient_context_json}
          onChange={set('topic_suggestions_json')}
        />
      </Section>

      <Separator />

      {/* ── Knowledge bank ───────────────────────────────────────────────── */}
      <KnowledgeBankSection />

      <Separator />

      {/* ── Billing ──────────────────────────────────────────────────────── */}
      <div id="billing" className="scroll-mt-20 space-y-4">
        <div>
          <h2 className="text-sm font-semibold">Billing</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Manage your subscription plan. Changes take effect immediately.
          </p>
        </div>

        {/* Return-from-Stripe toast */}
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

        {/* Current plan indicator */}
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
      try { await window.Clerk?.signOut?.() } catch { /* empty */ }
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
              <li>Cron jobs that reference this workspace start no-op&apos;ing.</li>
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

// Card-style link to a settings sub-page. Replaces the sections that have
// been extracted to dedicated routes (Bernard & voice, Output channels).
function SubpageLink({ to, title, description }) {
  return (
    <Link
      to={to}
      className="flex items-center justify-between gap-4 rounded-lg border border-input px-4 py-3 hover:bg-accent/30 transition-colors group"
    >
      <div>
        <p className="text-sm font-semibold">{title}</p>
        {description && <p className="text-xs text-muted-foreground mt-0.5">{description}</p>}
      </div>
      <ArrowRight className="h-4 w-4 text-muted-foreground shrink-0 group-hover:translate-x-0.5 transition-transform" />
    </Link>
  )
}

// ── Knowledge Bank Section ────────────────────────────────────────────────────

const KIND_META = {
  archetype:  { label: 'Patient archetypes',    color: 'bg-blue-100 text-blue-800' },
  condition:  { label: 'Conditions treated',    color: 'bg-green-100 text-green-800' },
  paradigm:   { label: 'Practice philosophy',   color: 'bg-purple-100 text-purple-800' },
  value:      { label: 'Core values',           color: 'bg-amber-100 text-amber-800' },
  objection:  { label: 'Patient hesitations',   color: 'bg-rose-100 text-rose-800' },
}

function KnowledgeBankSection() {
  const { getToken } = useAuth()
  const [concepts, setConcepts] = useState(null)
  const [loading, setLoading]   = useState(true)
  const [reextracting, setReextracting] = useState(false)
  const [toast, setToast]       = useState(null)

  const load = useCallback(() => {
    setLoading(true)
    fetch('/api/concepts/context?limit=50')
      .then(r => r.ok ? r.json() : { concepts: [] })
      .then(({ concepts: rows }) => setConcepts(rows || []))
      .catch(() => setConcepts([]))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { load() }, [load])

  async function reextract() {
    setReextracting(true)
    try {
      const token = await getToken()
      const r = await fetch('/api/concepts/reextract', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      })
      if (r.ok) {
        setToast('Re-extraction queued — results will appear within a minute.')
        setTimeout(() => { load(); setToast(null) }, 8000)
      } else {
        setToast('Re-extraction failed — check logs.')
        setTimeout(() => setToast(null), 4000)
      }
    } catch {
      setToast('Re-extraction failed.')
      setTimeout(() => setToast(null), 4000)
    } finally {
      setReextracting(false)
    }
  }

  const grouped = {}
  if (concepts) {
    for (const c of concepts) {
      if (!grouped[c.kind]) grouped[c.kind] = []
      grouped[c.kind].push(c)
    }
  }
  const totalCount = concepts?.length ?? 0
  const lastSeen = concepts?.length
    ? new Date(Math.max(...concepts.map(c => new Date(c.last_seen_at || 0)))).toLocaleDateString()
    : null

  return (
    <Section
      title="Knowledge bank"
      description="Learned automatically from completed interviews and approved content. Used to sharpen Bernard&apos;s questions and improve content drafts over time."
    >
      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading knowledge bank…
        </div>
      ) : totalCount === 0 ? (
        <p className="text-sm text-muted-foreground py-2">
          No concepts learned yet. Use the button below to seed from your existing approved content and completed interviews.
        </p>
      ) : (
        <div className="space-y-4">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>{totalCount} concepts learned{lastSeen ? ` · last updated ${lastSeen}` : ''}</span>
          </div>
          <div className="space-y-3">
            {Object.entries(KIND_META).filter(([kind]) => grouped[kind]?.length).map(([kind, meta]) => (
              <div key={kind}>
                <p className="text-xs font-medium text-muted-foreground mb-1.5">{meta.label}</p>
                <div className="flex flex-wrap gap-1.5">
                  {grouped[kind].slice(0, 12).map(c => (
                    <span
                      key={c.label}
                      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${meta.color}`}
                      title={`Evidence: ${c.evidence_count} · Weight: ${Number(c.weight).toFixed(1)}`}
                    >
                      {c.label}
                    </span>
                  ))}
                  {grouped[kind].length > 12 && (
                    <span className="text-xs text-muted-foreground self-center">+{grouped[kind].length - 12} more</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      {toast && (
        <p className="text-xs text-muted-foreground border rounded px-3 py-2 bg-muted">{toast}</p>
      )}
      <Button
        variant="outline" size="sm"
        onClick={reextract}
        disabled={reextracting || loading}
        className="mt-1"
      >
        {reextracting ? <><Loader2 className="h-3 w-3 mr-1.5 animate-spin" /> Re-extracting…</> : 'Re-extract from history'}
      </Button>
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

function Field({ label, value, onChange, placeholder, hint, type = 'text', autoComplete }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      <Input
        type={type}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        autoComplete={autoComplete}
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
            <img src={value} alt={label} className="h-full w-full object-contain" loading="lazy" decoding="async" />
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

// Per-topic archetype-tag editor. Renders each parsed topic_suggestions[]
// entry as a row with toggle chips for each archetype defined in
// patient_context.prototypes[]. Writes back into the JSON textarea so the
// shared Save flow handles persistence (no separate API path needed). If
// either JSON is unparseable or the workspace has no archetypes, the panel
// hides itself.
function TopicArchetypeEditor({ topicsJson, patientContextJson, onChange }) {
  let topics = null
  let archetypes = []
  try {
    const parsed = JSON.parse(topicsJson)
    if (Array.isArray(parsed)) topics = parsed
  } catch { /* fall through */ }
  try {
    const pc = JSON.parse(patientContextJson)
    if (pc && Array.isArray(pc.prototypes)) archetypes = pc.prototypes
  } catch { /* fall through */ }

  if (!topics) {
    return (
      <p className="text-[11px] text-muted-foreground italic">
        Per-topic archetype tags: fix the topic-suggestions JSON above to enable this editor.
      </p>
    )
  }
  if (archetypes.length === 0) {
    return (
      <p className="text-[11px] text-muted-foreground italic">
        Per-topic archetype tags: define <code>patient_context.prototypes[]</code> (each with an <code>id</code>) above to enable this editor.
      </p>
    )
  }
  if (topics.length === 0) {
    return (
      <p className="text-[11px] text-muted-foreground italic">
        Per-topic archetype tags: add a topic above first.
      </p>
    )
  }

  function toggle(idx, archetypeId) {
    const next = topics.map((row, i) => {
      if (i !== idx) return row
      const cur = Array.isArray(row.prototypes) ? row.prototypes : []
      const without = cur.filter((t) => t !== archetypeId)
      const newTags = cur.includes(archetypeId) ? without : [...without, archetypeId]
      // Drop the field entirely when empty so JSON stays minimal.
      const { prototypes: _drop, ...rest } = row
      return newTags.length > 0 ? { ...rest, prototypes: newTags } : rest
    })
    onChange(JSON.stringify(next, null, 2))
  }

  return (
    <div className="space-y-2">
      <Label className="text-xs">Per-topic archetype tags</Label>
      <p className="text-[11px] text-muted-foreground">
        Toggle which archetype(s) each topic primarily serves. Empty row = applies to all archetypes. Changes write to the JSON above; click Save to persist.
      </p>
      <div className="rounded-md border border-input divide-y divide-input max-h-96 overflow-y-auto">
        {topics.map((row, idx) => {
          const tags = Array.isArray(row.prototypes) ? row.prototypes : []
          return (
            <div key={idx} className="p-2 flex flex-wrap items-center gap-2">
              <div className="min-w-0 flex-1">
                <div className="text-xs font-medium truncate">{row.topic || <em className="text-muted-foreground">(untitled)</em>}</div>
                {row.category && (
                  <div className="text-[10px] text-muted-foreground truncate">{row.category}</div>
                )}
              </div>
              <div className="flex flex-wrap gap-1">
                {archetypes.map((a) => {
                  const active = tags.includes(a.id)
                  return (
                    <button
                      key={a.id}
                      type="button"
                      onClick={() => toggle(idx, a.id)}
                      className={`inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full border transition-colors ${
                        active
                          ? 'bg-primary text-primary-foreground border-primary'
                          : 'border-input hover:bg-accent/40'
                      }`}
                      title={a.coreDesire || a.label}
                    >
                      {a.emoji && <span>{a.emoji}</span>}
                      {a.shortLabel || a.label || a.id}
                    </button>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>
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

  useEffect(() => { reload()   }, [])

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
          <Input value={draft.city} onChange={e => set('city')(e.target.value)} placeholder="Portland" className="text-sm" autoComplete="address-level2" />
        </div>
        <div className="col-span-3 space-y-1">
          <Label className="text-xs">State</Label>
          <Input value={draft.region} onChange={e => set('region')(e.target.value)} placeholder="OR" className="text-sm" autoComplete="address-level1" />
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
          <p className="text-[10px] text-muted-foreground">Used in copy and &apos;near me&apos; SEO.</p>
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
          type="url"
          value={draft.visit_url}
          onChange={e => set('visit_url')(e.target.value)}
          placeholder="https://yourpractice.com/visit/portland"
          className="text-sm"
          autoComplete="off"
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
          Buffer profile ID for this location&apos;s Google Business listing. Find it
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
