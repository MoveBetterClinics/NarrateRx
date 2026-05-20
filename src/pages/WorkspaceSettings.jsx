import { useState, useEffect } from 'react'
import { Navigate, Link, useSearchParams, useNavigate } from 'react-router-dom'
import { useAuth } from '@clerk/clerk-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card'
import { Loader2, CheckCircle2, AlertCircle } from 'lucide-react'
import LoadingState from '@/components/LoadingState'
import { SaveBar } from '@/components/settings/helpers'
import { useUserRole } from '@/lib/useUserRole'
import { useUnsavedChanges } from '@/lib/useUnsavedChanges'
import { useSaveShortcut } from '@/lib/useSaveShortcut'
import { useDocumentTitle } from '@/lib/useDocumentTitle'
import SchedulePrefsSection from '@/components/settings/SchedulePrefsSection'

// General tab — identity, web presence, social handles, approval workflow,
// and content strings. Logos / colors / brandbook moved to Brand Kit;
// locations moved to /settings/workspace/locations; paradigm content moved
// to /settings/workspace/voice; billing moved to /settings/workspace/billing.
function formFromWorkspace(ws) {
  return {
    display_name:            ws.display_name            ?? '',
    tagline:                 ws.tagline                 ?? '',
    sign_in_blurb:           ws.sign_in_blurb           ?? '',
    app_name:                ws.app_name                ?? '',
    website:                 ws.website                 ?? '',
    website_hostname:        ws.website_hostname        ?? '',
    booking_url:             ws.booking_url             ?? '',
    link_preview_blurb:      ws.link_preview_blurb      ?? '',
    social_instagram:        ws.social?.instagram       ?? '',
    social_facebook:         ws.social?.facebook        ?? '',
    internal_links_markdown: ws.internal_links_markdown ?? '',
    signature_system_name:   ws.signature_system_name   ?? '',
    signature_system_url:    ws.signature_system_url    ?? '',
    pinterest_boards:        ws.pinterest_boards        ?? '',
    brand_hashtag:           ws.brand_hashtag           ?? '',
    spoken_url:              ws.spoken_url              ?? '',
    skip_review:             !!ws.skip_review,
    buffer_use_queue:        !!ws.buffer_use_queue,
    schedule_prefs:          ws.schedule_prefs ?? null,
  }
}

function formToPatch(form) {
  return {
    display_name:            form.display_name,
    tagline:                 form.tagline,
    sign_in_blurb:           form.sign_in_blurb,
    app_name:                form.app_name,
    website:                 form.website,
    website_hostname:        form.website_hostname,
    booking_url:             form.booking_url,
    link_preview_blurb:      form.link_preview_blurb,
    social: {
      instagram: form.social_instagram,
      facebook:  form.social_facebook,
    },
    internal_links_markdown: form.internal_links_markdown,
    signature_system_name:   form.signature_system_name || null,
    signature_system_url:    form.signature_system_url  || null,
    pinterest_boards:        form.pinterest_boards,
    brand_hashtag:           form.brand_hashtag,
    spoken_url:              form.spoken_url,
    skip_review:             !!form.skip_review,
    buffer_use_queue:        !!form.buffer_use_queue,
    schedule_prefs:          form.schedule_prefs ?? null,
  }
}

export default function WorkspaceSettings() {
  useDocumentTitle('Settings — Workspace')
  const { getToken } = useAuth()
  const { role, isLoading: roleLoading } = useUserRole()
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const [ws, setWs]       = useState(undefined)
  const [form, setForm]   = useState(null)
  const [pristineForm, setPristineForm] = useState(null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved]   = useState(false)
  const [error, setError]   = useState(null)

  // Legacy redirect: /settings/workspace?billing=... and /settings/workspace#billing
  // now live at /settings/workspace/billing.
  useEffect(() => {
    const billing = searchParams.get('billing')
    if (billing) {
      navigate(`/settings/workspace/billing?billing=${billing}`, { replace: true })
      return
    }
    if (window.location.hash === '#billing') {
      navigate('/settings/workspace/billing', { replace: true })
    }
  }, [searchParams, navigate])

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

  const isDirty = !!form && !!pristineForm && JSON.stringify(form) !== JSON.stringify(pristineForm)
  useUnsavedChanges(isDirty)
  useSaveShortcut(() => { if (isDirty && !saving) handleSave() }, { disabled: !isDirty || saving })

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

  if (roleLoading || ws === undefined) return <LoadingState />

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
    <div className="space-y-6 pb-16">
      {/* Sticky header / save bar */}
      <div className="md:sticky md:top-14 z-20 py-4 bg-background/85 backdrop-blur supports-[backdrop-filter]:bg-background/70 border-b border-border/60 flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-tight flex items-center">
            <span
              className="inline-block w-1 h-6 rounded-full shrink-0 mr-2.5"
              style={{ background: 'hsl(var(--primary))' }}
              aria-hidden="true"
            />
            General
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Identity, web presence, and content strings used across prompts and link previews.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0 pt-1">
          {saved && (
            <span className="text-xs text-success flex items-center gap-1">
              <CheckCircle2 className="h-3.5 w-3.5" />Saved
            </span>
          )}
          {error && (
            <span className="text-xs text-destructive flex items-center gap-1">
              <AlertCircle className="h-3.5 w-3.5" />{error}
            </span>
          )}
          <Button size="sm" onClick={handleSave} disabled={saving || !isDirty}>
            {saving && <Loader2 className="h-4 w-4 animate-spin mr-1.5" />}
            Save changes
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <SectionCard
        title="Identity"
        description="How this workspace introduces itself on the sign-in screen and in the browser tab."
      >
        <Grid>
          <Field label="Workspace name"
            value={form.display_name} onChange={set('display_name')} />
          <Field label="Tagline"
            value={form.tagline} onChange={set('tagline')} />
        </Grid>
        <Field label="Sign-in blurb"
          value={form.sign_in_blurb} onChange={set('sign_in_blurb')}
          hint="Shown below the workspace name on the sign-in screen." />
        <Field label="App name"
          value={form.app_name} onChange={set('app_name')}
          hint="App name in the browser tab — e.g. “Move Better — NarrateRx”." />
      </SectionCard>

      <SectionCard
        title="Web presence"
        description="Where this workspace lives on the web. Drives outbound links and link previews."
      >
        <Grid>
          <Field label="Website"
            value={form.website} onChange={set('website')} placeholder="https://..." type="url" autoComplete="url" />
          <Field label="Website hostname"
            value={form.website_hostname} onChange={set('website_hostname')}
            placeholder="movebetter.co"
            hint="Hostname only — no protocol or trailing slash." />
        </Grid>
        <Field label="Booking URL"
          value={form.booking_url} onChange={set('booking_url')}
          placeholder="https://..." type="url" autoComplete="off"
          hint="Primary call-to-action URL. Used in blog CTAs, email buttons, and social bios in generated copy." />
        <Textarea2 label="Link preview blurb"
          value={form.link_preview_blurb} onChange={set('link_preview_blurb')}
          rows={2}
          hint="OG / link-preview blurb — one sentence under 130 chars." />
      </SectionCard>

      <SectionCard
        title="Social handles"
        description="Used for @-mentions in generated copy and source-of-truth URLs."
      >
        <Grid>
          <Field label="Instagram handle"
            value={form.social_instagram} onChange={set('social_instagram')} placeholder="yourhandle" />
          <Field label="Facebook handle"
            value={form.social_facebook} onChange={set('social_facebook')} placeholder="yourpage" />
        </Grid>
      </SectionCard>

      <SectionCard
        title="Approval workflow"
        description="When off, drafts route through a reviewer (Send for review → Approve → Publish). Turn this on for single-user workspaces so the editor can publish directly."
      >
        <label className="flex items-start gap-3 rounded-lg border border-input p-3.5 cursor-pointer hover:bg-accent/30 transition-colors">
          <input
            type="checkbox"
            checked={!!form.skip_review}
            onChange={(e) => setForm((f) => ({ ...f, skip_review: e.target.checked }))}
            className="mt-0.5 h-4 w-4"
          />
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium leading-tight">Skip review step</div>
            <div className="text-xs text-muted-foreground mt-1">
              Editors can publish directly from a draft. No reviewer approval required.
            </div>
          </div>
        </label>
      </SectionCard>

      <SectionCard
        title="Publish timing"
        description="Where the approve action sheet defaults when picking a publish time."
      >
        <label className="flex items-start gap-3 rounded-lg border border-input p-3.5 cursor-pointer hover:bg-accent/30 transition-colors">
          <input
            type="checkbox"
            checked={!!form.buffer_use_queue}
            onChange={(e) => setForm((f) => ({ ...f, buffer_use_queue: e.target.checked }))}
            className="mt-0.5 h-4 w-4"
          />
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium leading-tight">Use Buffer&rsquo;s queue by default</div>
            <div className="text-xs text-muted-foreground mt-1">
              When approving a post, the primary action becomes &ldquo;Add to Buffer queue&rdquo; — Buffer slots the post into the next open spot on your channel&rsquo;s schedule. Keep this off to use NarrateRx&rsquo;s platform-aware suggested times instead. &ldquo;Pick a specific time&rdquo; and &ldquo;Publish now&rdquo; remain available either way.
            </div>
          </div>
        </label>
      </SectionCard>

      <SectionCard
        title="Optimal posting times"
        description="Per-platform day/hour preferences that drive the suggested time on the approve action sheet and the optimal-time tint on the calendar."
        className="lg:col-span-2"
      >
        <SchedulePrefsSection
          value={form.schedule_prefs}
          onChange={(v) => setForm((f) => ({ ...f, schedule_prefs: v }))}
        />
      </SectionCard>

      <SectionCard
        title="Content strings"
        description="Reusable phrases and links that flow into generated copy."
        className="lg:col-span-2"
      >
        <Textarea2
          label="Internal links (Markdown)"
          value={form.internal_links_markdown}
          onChange={set('internal_links_markdown')}
          rows={8}
          mono
          hint="Markdown list of pages. The blog post prompt uses these for contextual linking."
        />
        <Grid>
          <Field label="Signature system name"
            value={form.signature_system_name} onChange={set('signature_system_name')}
            placeholder="Leave blank if none" />
          <Field label="Signature system URL"
            value={form.signature_system_url} onChange={set('signature_system_url')}
            placeholder="https://..." />
        </Grid>
        <Field label="Pinterest board names"
          value={form.pinterest_boards} onChange={set('pinterest_boards')}
          hint="Slash-separated — e.g. “Home tips / Recovery / Mobility”." />
        <Grid>
          <Field label="Brand hashtag"
            value={form.brand_hashtag} onChange={set('brand_hashtag')}
            placeholder="#MoveBetter" />
          <Field label="Spoken URL"
            value={form.spoken_url} onChange={set('spoken_url')}
            placeholder="MoveBetter.co"
            hint="Said aloud in video scripts." />
        </Grid>
        <p className="text-xs text-muted-foreground">
          Location keyword and hashtag now live with each location in the{' '}
          <Link to="/settings/workspace/locations" className="underline underline-offset-2 hover:text-foreground">Locations tab</Link>
          {' '}— the primary location&apos;s values flow into prompts automatically.
        </p>
      </SectionCard>

      </div>

      <DangerZone workspace={ws} getToken={getToken} />

      {/* Mobile-only sticky-bottom save bar — the page header bar that
          holds Save is non-sticky on mobile (PR #657), so without this
          the user has to scroll back to the top of a long form to save. */}
      <div className="md:hidden">
        <SaveBar
          saving={saving}
          saved={saved}
          error={error}
          isDirty={isDirty}
          onSave={handleSave}
          onDiscard={() => setForm(pristineForm)}
        />
      </div>
    </div>
  )
}

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
      try { await window.Clerk?.signOut?.() } catch { /* empty */ }
      window.location.href = 'https://narraterx.ai'
    } catch (e) {
      setError(e?.message || 'network-error')
      setArchiving(false)
    }
  }

  return (
    <Card className="rounded-2xl border-destructive/30 shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
      <CardHeader>
        <div className="flex items-center gap-2">
          <span
            className="inline-block w-1 h-5 rounded-full shrink-0"
            style={{ background: 'hsl(var(--destructive))' }}
            aria-hidden="true"
          />
          <CardTitle className="text-lg font-bold text-destructive">Danger zone</CardTitle>
        </div>
        <CardDescription>
          Destructive actions. Read carefully — these affect every member of the workspace.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="rounded-lg border-2 border-destructive/30 bg-destructive/5 p-4 space-y-3">
          <div className="flex items-start gap-2">
            <AlertCircle className="h-4 w-4 text-destructive shrink-0 mt-0.5" aria-hidden="true" />
            <div>
              <p className="text-sm font-semibold text-destructive">Archive workspace</p>
              <p className="text-xs text-muted-foreground mt-1">
                Suspends this workspace immediately. All members lose access — the subdomain stops resolving and every API call returns 404. Content, media, and credentials stay in storage so the workspace can be restored manually via the database.
              </p>
              <ul className="text-2xs text-muted-foreground list-disc pl-4 mt-1.5 space-y-0.5">
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
              className="h-10 text-sm"
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

        <p className="text-2xs text-muted-foreground">
          Rename, transfer ownership, and hard delete are not available in-app yet — each requires substantial server work. Contact the platform team (drq@narraterx.ai) for any of these.
        </p>
      </CardContent>
    </Card>
  )
}

function SectionCard({ title, description, children, className = '' }) {
  return (
    <Card className={`rounded-2xl shadow-[0_1px_2px_rgba(15,23,42,0.03)] ${className}`}>
      <CardHeader className="pb-4">
        <div className="flex items-center gap-2">
          <span
            className="inline-block w-1 h-5 rounded-full shrink-0"
            style={{ background: 'hsl(var(--primary))' }}
            aria-hidden="true"
          />
          <CardTitle className="text-lg font-bold">{title}</CardTitle>
        </div>
        {description && <CardDescription className="text-xs">{description}</CardDescription>}
      </CardHeader>
      <CardContent className="space-y-5">
        {children}
      </CardContent>
    </Card>
  )
}

function Grid({ children }) {
  return <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">{children}</div>
}

function Field({ label, value, onChange, placeholder, hint, type = 'text', autoComplete }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-sm font-medium">{label}</Label>
      <Input
        type={type}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        autoComplete={autoComplete}
        className="h-10 text-sm"
      />
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  )
}

function Textarea2({ label, value, onChange, rows = 4, hint, mono = false }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-sm font-medium">{label}</Label>
      <Textarea
        value={value}
        onChange={e => onChange(e.target.value)}
        rows={rows}
        className={`text-sm resize-y ${mono ? 'font-mono' : ''}`}
      />
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  )
}
