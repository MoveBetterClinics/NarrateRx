import { useState, useEffect } from 'react'
import { Navigate, Link, useSearchParams, useNavigate } from 'react-router-dom'
import { useAuth } from '@clerk/clerk-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Separator } from '@/components/ui/separator'
import { Loader2, CheckCircle2, AlertCircle, ArrowRight } from 'lucide-react'
import { useUserRole } from '@/lib/useUserRole'
import { useUnsavedChanges } from '@/lib/useUnsavedChanges'
import { useSaveShortcut } from '@/lib/useSaveShortcut'
import { useDocumentTitle } from '@/lib/useDocumentTitle'

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
  // now live at /settings/workspace/billing. Hash compat is for bookmarks
  // saved before the tab restructure (PR for "settings cleanup", 2026-05-15).
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
            Identity, web presence, and content strings. Logos &amp; colors live in Brand kit; locations and billing have their own tabs.
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

      <Section title="Content strings">
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
        <Field label="Brand hashtag"
          value={form.brand_hashtag} onChange={set('brand_hashtag')}
          placeholder="#MoveBetter"
          hint="Brand hashtag — e.g. #MoveBetter" />
        <Field label="Spoken URL"
          value={form.spoken_url} onChange={set('spoken_url')}
          placeholder="MoveBetter.co"
          hint="Spoken URL — said aloud in video scripts, e.g. MoveBetter.co" />
        <p className="text-[11px] text-muted-foreground">
          Location keyword and hashtag now live with each location in the <Link to="/settings/workspace/locations" className="underline">Locations tab</Link> — the primary location&apos;s values flow into prompts automatically.
        </p>
      </Section>

      <Separator />

      <SubpageLink
        to="/settings/workspace/voice"
        title="Bernard & voice"
        description="AI voice context, brand voice, audience, tone modifiers, and paradigm content (patient archetypes, interview bank, topic suggestions)."
      />
      <SubpageLink
        to="/settings/workspace/locations"
        title="Locations"
        description="Each physical site you operate, with city, state, location keyword / hashtag, and per-location GBP channel ID."
      />
      <SubpageLink
        to="/settings/workspace/channels"
        title="Output channels"
        description="Choose which channels this workspace generates content for, and manage publishing credentials."
      />
      <SubpageLink
        to="/settings/brand-kit"
        title="Brand kit"
        description="Logos, colors, fonts, and brand book reference."
      />
      <SubpageLink
        to="/settings/workspace/billing"
        title="Plan & billing"
        description="Manage your subscription plan and seats."
      />

      <Separator />
      <DangerZone workspace={ws} getToken={getToken} />
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
