import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useAuth } from '@clerk/clerk-react'
import {
  ExternalLink,
  AlertCircle,
  ChevronDown,
  ChevronUp,
  Sparkles,
  Mail,
  HardDrive,
  Loader2,
  CheckCircle2,
  XCircle,
  Lightbulb,
} from 'lucide-react'
import { Separator } from '@/components/ui/separator'
import { Button } from '@/components/ui/button'
import CredentialForm from '@/components/CredentialForm'
import { useWorkspace } from '@/lib/WorkspaceContext'
import { useUserRole } from '@/lib/useUserRole'
import { useDocumentTitle } from '@/lib/useDocumentTitle'
import { apiFetch, apiFetchResponse } from '@/lib/api'
import { toast } from '@/lib/toast'

// Customer-facing publishing connect page. Per-workspace credentials are
// stored encrypted via /api/workspace/credentials. Buffer is the recommended
// integration for every workspace and now covers Google Business Profile too
// (per-location channel IDs live on workspace_locations rows). TDC stays
// first-party only and renders behind a capability flag.

const INTEGRATIONS = [
  {
    id: 'buffer',
    label: 'Buffer',
    recommended: true,
    description:
      'One connection that fans NarrateRx posts out to Instagram, Facebook, LinkedIn, Twitter/X, Threads, Pinterest, TikTok, YouTube Shorts, Bluesky, Mastodon, Google Business Profile, and more. The fastest way to get NarrateRx publishing for your workspace.',
    platforms: ['Instagram', 'Facebook', 'LinkedIn', 'Twitter/X', 'Threads', 'Pinterest', 'TikTok', 'YouTube Shorts', 'Mastodon', 'Bluesky', 'Google Business Profile'],
    secretLabel: 'Buffer access token',
    secretPlaceholder: 'access_token_…',
    fields: [],
    setupSteps: [
      'Sign in (or sign up) at buffer.com.',
      'In Buffer, connect every channel you want NarrateRx to publish to (Instagram, Facebook Page, LinkedIn, X, TikTok, etc.).',
      'Open publish.buffer.com/settings/api and go to the Personal Keys tab.',
      'Click + New Key, give it a name (e.g. "NarrateRx"), and copy the token.',
      'Paste it below and Save — your token is stored encrypted and used only at publish time.',
    ],
    docsUrl: 'https://buffer.com/developers/api',
  },
  // Facebook direct (Graph API) retired 2026-05-10. Google Business Profile
  // direct (service account) retired 2026-05-11. Both publish through the
  // Buffer channel above; GBP listings additionally need their per-location
  // Buffer profile ID pasted into Workspace Settings → Locations.
  {
    id: 'wordpress',
    label: 'WordPress (REST publish)',
    description: 'Publish blog posts directly to a WordPress site via the REST API + an application password.',
    platforms: ['Website'],
    secretLabel: 'Application password',
    secretPlaceholder: 'xxxx xxxx xxxx xxxx',
    fields: [
      { key: 'site_url', label: 'REST endpoint (must include /wp-json/)', placeholder: 'https://example.com/wp-json/wp/v2/posts' },
      { key: 'user',     label: 'WordPress username',                      placeholder: 'editor' },
    ],
    setupSteps: [
      'In WordPress admin, generate an Application Password for an editor-level user.',
      'Paste the username + app password below and Save.',
    ],
    docsUrl: 'https://wordpress.org/documentation/article/application-passwords/',
  },
  {
    id: 'astro_github',
    label: 'Astro + GitHub website',
    description: 'Webhook-based publish to an Astro site that commits markdown to a GitHub repo.',
    platforms: ['Website'],
    secretLabel: 'Shared bearer secret',
    secretPlaceholder: 'long-random-string',
    fields: [
      { key: 'url', label: 'Publish webhook URL', placeholder: 'https://example.com/api/publish' },
    ],
    setupSteps: [
      'Stand up the Astro publish endpoint and pick a bearer secret.',
      'Paste the URL + secret below and Save.',
    ],
    docsUrl: null,
  },
]

const EMAIL_MERGE_TAGS = [
  { tag: '{{preview_text}}',     desc: 'Inbox snippet shown below the subject line (50–90 chars)' },
  { tag: '{{headline}}',         desc: 'Large bold heading at the top of the email body' },
  { tag: '{{pull_quote}}',       desc: 'Styled green callout block — most compelling line from the piece' },
  { tag: '{{body_paragraph_1}}', desc: 'Opening hook paragraph' },
  { tag: '{{body_paragraph_2}}', desc: 'Workspace perspective paragraph' },
  { tag: '{{body_paragraph_3}}', desc: 'Patient story + bridge to action paragraph' },
  { tag: '{{cta_text}}',         desc: 'Button label only (e.g. "Book a Free Consultation")' },
  { tag: '{{cta_url}}',          desc: 'Button destination URL' },
  { tag: '{{ps_text}}',          desc: 'Optional P.S. line after the CTA' },
  { tag: '{{hero_image_url}}',   desc: 'Full URL of the hero image shown below the header' },
  { tag: '{{year}}',             desc: 'Auto-filled — current year for the copyright line' },
  { tag: '{{unsubscribe_url}}',  desc: 'Auto-filled by TrustDrivenCare at send time' },
  { tag: '{{webview_url}}',      desc: 'Auto-filled by TrustDrivenCare at send time' },
]

function hasCapability(ws, key) {
  if (!key) return true
  return Boolean(ws?.capabilities?.[key])
}

export default function Integrations() {
  useDocumentTitle('Integrations')
  const ws = useWorkspace()
  const { role, isLoading: roleLoading } = useUserRole()
  const { getToken } = useAuth()
  const [services, setServices] = useState(null) // null=loading, [] when none
  const [loadError, setLoadError] = useState(null)

  const visible = INTEGRATIONS.filter((i) => hasCapability(ws, i.capabilityKey))
  const showTdc = hasCapability(ws, 'tdcPublish')
  const isAdmin = role === 'admin'

  async function reload() {
    try {
      const data = await apiFetch('/api/workspace/credentials')
      setServices(Array.isArray(data?.services) ? data.services : [])
      setLoadError(null)
    } catch (err) {
      setServices([])
      if (err?.status === 403) setLoadError('Admins only.')
      else if (err?.status === 401) setLoadError('Your session expired — reload the page.')
      else setLoadError(err?.message || 'Network error loading credentials.')
    }
  }

  useEffect(() => {
    if (!isAdmin || roleLoading) return
    reload()
  }, [isAdmin, roleLoading])

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center">
          <span
            className="inline-block w-1 h-6 rounded-full shrink-0 mr-2.5"
            style={{ background: '#7c3aed' }}
            aria-hidden="true"
          />
          Integrations
        </h1>
        <p className="text-muted-foreground text-sm mt-1">
          Connect publishing platforms so NarrateRx can push finished posts straight from the Content Hub.
          Credentials are stored encrypted (AES-256-GCM) and decrypted only at publish time.
        </p>
      </div>

      {!isAdmin && !roleLoading && (
        <div className="rounded-lg border bg-muted/40 px-4 py-3 flex items-start gap-3">
          <AlertCircle className="h-4 w-4 text-warning shrink-0 mt-0.5" />
          <p className="text-sm text-muted-foreground">
            Only workspace admins can connect publishing integrations. Ask your admin to set this up.
          </p>
        </div>
      )}

      {isAdmin && loadError && (
        <div className="rounded-lg border bg-muted/40 px-4 py-3 flex items-start gap-3">
          <AlertCircle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
          <p className="text-sm text-muted-foreground">{loadError}</p>
        </div>
      )}

      <div className="space-y-4">
        {visible.map((integration) => {
          const row = services?.find?.((s) => s.service === integration.id) || null
          return (
            <IntegrationCard
              key={integration.id}
              integration={integration}
              row={row}
              loading={services === null && isAdmin}
              disabled={!isAdmin}
              getToken={getToken}
              onChange={reload}
            />
          )
        })}

        <GoogleDriveCard
          row={services?.find?.((s) => s.service === 'drive') || null}
          loading={services === null && isAdmin}
          disabled={!isAdmin}
          onChange={reload}
        />
      </div>

      {showTdc && <TrustDrivenCareCard />}
    </div>
  )
}

function IntegrationCard({ integration, row, loading, disabled, getToken, onChange }) {
  const [open, setOpen] = useState(integration.recommended)
  const configured = Boolean(row)

  return (
    <div
      className={`rounded-xl border bg-card overflow-hidden ${
        integration.recommended ? 'border-orange-300 ring-1 ring-orange-200' : ''
      }`}
    >
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-5 py-4 hover:bg-accent/30 transition-colors text-left"
      >
        <div className="flex items-start gap-3 min-w-0">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <p className="font-medium">{integration.label}</p>
              {integration.recommended && (
                <span className="inline-flex items-center gap-1 text-3xs uppercase tracking-wide bg-orange-100 text-orange-700 px-1.5 py-0.5 rounded">
                  <Sparkles className="h-3 w-3" /> Recommended
                </span>
              )}
              {configured ? (
                <span className="text-3xs uppercase tracking-wide bg-green-100 text-green-700 px-1.5 py-0.5 rounded">
                  Connected
                </span>
              ) : !loading ? (
                <span className="text-3xs uppercase tracking-wide bg-muted text-muted-foreground px-1.5 py-0.5 rounded">
                  Not connected
                </span>
              ) : null}
            </div>
            <p className="text-sm text-muted-foreground mt-0.5">{integration.description}</p>
            <div className="flex gap-1 mt-1.5 flex-wrap">
              {integration.platforms.map((p) => (
                <span key={p} className="text-xs bg-muted px-2 py-0.5 rounded-full text-muted-foreground">{p}</span>
              ))}
            </div>
          </div>
        </div>
        {open ? <ChevronUp className="h-4 w-4 text-muted-foreground shrink-0" /> : <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />}
      </button>

      {open && (
        <div className="px-5 pb-5 space-y-5 border-t pt-4">
          <SetupSteps integration={integration} />
          <Separator />
          <CredentialForm
            service={integration}
            row={row}
            disabled={disabled}
            getToken={getToken}
            tokenOpts={{ skipCache: true }}
            onChange={onChange}
            removeLabel="Disconnect"
            saveLabel={({ configured }) => (configured ? 'Update' : 'Connect')}
            secretPlaceholder={integration.secretPlaceholder}
            confirmMessage={(svc) => `Disconnect ${svc.label} for this workspace?`}
          />
        </div>
      )}
    </div>
  )
}


// Reason codes the OAuth callback uses in ?drive=error&reason=…. Mapped to
// human copy so the toast actually tells the admin what went wrong.
const DRIVE_ERROR_COPY = {
  access_denied: 'You declined the Google permission prompt — no changes saved.',
  exchange_failed: 'Google rejected the OAuth code. Try connecting again.',
  persist_failed: 'Connected to Google, but we couldn’t save the credential. Try again or contact support.',
}

function GoogleDriveCard({ row, loading, disabled, onChange }) {
  const [open, setOpen] = useState(!row)
  const [connecting, setConnecting] = useState(false)
  const [disconnecting, setDisconnecting] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState(null)
  const [searchParams, setSearchParams] = useSearchParams()
  const configured = Boolean(row)
  const connectedEmail = row?.config?.account_email || null

  // Surface the OAuth callback's outcome as a toast, then strip the query
  // params so a reload doesn't replay it. Runs once per param value.
  useEffect(() => {
    const status = searchParams.get('drive')
    if (!status) return
    if (status === 'connected') {
      toast.success('Google Drive connected.')
      onChange?.()
    } else if (status === 'error') {
      const reason = searchParams.get('reason') || 'unknown'
      toast.error(DRIVE_ERROR_COPY[reason] || `Drive connect failed: ${reason}`)
    }
    const next = new URLSearchParams(searchParams)
    next.delete('drive')
    next.delete('reason')
    setSearchParams(next, { replace: true })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function handleConnect() {
    setConnecting(true)
    setTestResult(null)
    try {
      const data = await apiFetch('/api/integrations/drive/connect', { method: 'POST' })
      if (!data?.url) throw new Error('No OAuth URL returned')
      window.location.assign(data.url)
    } catch (err) {
      setConnecting(false)
      if (err?.status === 503) {
        toast.error('Google Drive OAuth client isn’t configured on this deployment yet.')
      } else if (err?.status === 403) {
        toast.error('Only workspace admins can connect Google Drive.')
      } else {
        toast.error(err?.message || 'Couldn’t start the Google connect flow.')
      }
    }
  }

  async function handleDisconnect() {
    if (!window.confirm('Disconnect Google Drive for this workspace? Previously imported assets will remain in the Library, but new imports will require reconnecting.')) {
      return
    }
    setDisconnecting(true)
    try {
      await apiFetchResponse('/api/integrations/drive/disconnect', { method: 'DELETE' })
      toast.success('Google Drive disconnected.')
      setTestResult(null)
      onChange?.()
    } catch (err) {
      toast.error(err?.message || 'Couldn’t disconnect Google Drive.')
    } finally {
      setDisconnecting(false)
    }
  }

  async function handleTest() {
    setTesting(true)
    setTestResult(null)
    try {
      const data = await apiFetch('/api/integrations/drive/test')
      setTestResult({ ok: true, email: data?.user?.email || null, name: data?.user?.name || null })
    } catch (err) {
      if (err?.status === 412) {
        setTestResult({ ok: false, message: 'Reconnect required — Google revoked access or the token is missing.' })
      } else {
        setTestResult({ ok: false, message: err?.message || 'Test failed.' })
      }
    } finally {
      setTesting(false)
    }
  }

  return (
    <div className="rounded-xl border bg-card overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-5 py-4 hover:bg-accent/30 transition-colors text-left"
      >
        <div className="flex items-start gap-3 min-w-0">
          <HardDrive className="h-5 w-5 text-primary shrink-0 mt-0.5" />
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <p className="font-medium">Google Drive</p>
              {configured ? (
                <span className="text-3xs uppercase tracking-wide bg-green-100 text-green-700 px-1.5 py-0.5 rounded">
                  Connected
                </span>
              ) : !loading ? (
                <span className="text-3xs uppercase tracking-wide bg-muted text-muted-foreground px-1.5 py-0.5 rounded">
                  Not connected
                </span>
              ) : null}
            </div>
            <p className="text-sm text-muted-foreground mt-0.5">
              Pull source photos and videos from your Drive into the Media Library. NarrateRx can only see files you specifically pick — we never see the rest of your Drive.
            </p>
            {configured && connectedEmail && (
              <p className="text-xs text-muted-foreground mt-1">
                Connected as <span className="font-medium">{connectedEmail}</span>
              </p>
            )}
            <div className="flex gap-1 mt-1.5 flex-wrap">
              <span className="text-xs bg-muted px-2 py-0.5 rounded-full text-muted-foreground">Media import</span>
              <span className="text-xs bg-muted px-2 py-0.5 rounded-full text-muted-foreground">Per-file access</span>
            </div>
          </div>
        </div>
        {open ? <ChevronUp className="h-4 w-4 text-muted-foreground shrink-0" /> : <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />}
      </button>

      {open && (
        <div className="px-5 pb-5 space-y-5 border-t pt-4">
          <div>
            <p className="text-sm font-medium mb-2">How it works</p>
            <ol className="space-y-1.5">
              {[
                'Click Connect Google Drive below — you’ll be sent to Google to sign in and grant NarrateRx the ability to read files you later pick.',
                'Back in the Library, use Import from Drive. Google’s own file picker opens; the files you select are the only files NarrateRx ever sees.',
                'Selected files copy into NarrateRx and run through the normal Library pipeline (tagging, transcription, thumbnails). Drive stays the master archive.',
              ].map((step, i) => (
                <li key={i} className="flex gap-2 text-sm text-muted-foreground">
                  <span className="text-primary font-semibold shrink-0">{i + 1}.</span>
                  {step}
                </li>
              ))}
            </ol>
          </div>

          <Separator />

          {!configured ? (
            <div className="space-y-3">
              {/* Best-practice nudge: every workspace member who imports sees
                  the same Drive as whoever connects, so connecting with a
                  personal account exposes that account's whole media library
                  to the team. Dedicated/limited account is the safer default
                  and matches how most clinics actually organize source files. */}
              <div className="rounded-lg border border-amber-200 bg-amber-50/60 px-3.5 py-2.5 flex items-start gap-2.5">
                <Lightbulb className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
                <div className="text-xs text-amber-900 leading-relaxed">
                  <span className="font-semibold">Tip — connect with a dedicated account.</span>{' '}
                  Pick a Google account whose Drive contains only the photos and videos you want NarrateRx to see — ideally a shared clinic account, or one whose Drive holds your media Shared Drive. Every workspace member who imports will see the same Drive view, so avoid using a personal account with private photos.
                </div>
              </div>
              <Button onClick={handleConnect} disabled={disabled || connecting}>
                {connecting ? (
                  <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Redirecting to Google…</>
                ) : (
                  <>Connect Google Drive</>
                )}
              </Button>
              {disabled && (
                <p className="text-xs text-muted-foreground mt-2">Admins only.</p>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <Button variant="outline" onClick={handleTest} disabled={testing}>
                  {testing ? (
                    <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Testing…</>
                  ) : (
                    <>Test connection</>
                  )}
                </Button>
                <Button variant="outline" onClick={handleConnect} disabled={connecting}>
                  {connecting ? 'Reconnecting…' : 'Reconnect (switch account)'}
                </Button>
                <Button variant="ghost" className="text-destructive hover:text-destructive" onClick={handleDisconnect} disabled={disconnecting}>
                  {disconnecting ? 'Disconnecting…' : 'Disconnect'}
                </Button>
              </div>

              {testResult && (
                <div className={`flex items-start gap-2 rounded-md border px-3 py-2 text-sm ${
                  testResult.ok
                    ? 'border-green-200 bg-green-50 text-green-800'
                    : 'border-destructive/30 bg-destructive/5 text-destructive'
                }`}>
                  {testResult.ok ? (
                    <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5" />
                  ) : (
                    <XCircle className="h-4 w-4 shrink-0 mt-0.5" />
                  )}
                  <div>
                    {testResult.ok ? (
                      <>
                        Connection works. {testResult.email ? <>Drive is reachable as <span className="font-medium">{testResult.email}</span>.</> : null}
                      </>
                    ) : (
                      <>{testResult.message}</>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function SetupSteps({ integration }) {
  return (
    <div>
      <p className="text-sm font-medium mb-2">Setup steps</p>
      <ol className="space-y-1.5">
        {integration.setupSteps.map((step, i) => (
          <li key={i} className="flex gap-2 text-sm text-muted-foreground">
            <span className="text-primary font-semibold shrink-0">{i + 1}.</span>
            {step}
          </li>
        ))}
      </ol>
      {integration.docsUrl && (
        <a
          href={integration.docsUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-xs text-primary mt-2 hover:underline"
        >
          Full documentation <ExternalLink className="h-3 w-3" />
        </a>
      )}
    </div>
  )
}

function TrustDrivenCareCard() {
  const ws = useWorkspace()
  const [open, setOpen] = useState(false)
  const [copiedTag, setCopiedTag] = useState(null)
  const templateName = ws?.newsletter_template_name || 'TrustDrivenCare'

  function copyTag(tag) {
    navigator.clipboard.writeText(tag)
    setCopiedTag(tag)
    setTimeout(() => setCopiedTag(null), 1500)
  }

  return (
    <div className="rounded-xl border bg-card overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-5 py-4 hover:bg-accent/30 transition-colors text-left"
      >
        <div className="flex items-start gap-3">
          <Mail className="h-5 w-5 text-primary shrink-0 mt-0.5" />
          <div>
            <p className="font-medium">TrustDrivenCare — Email Newsletter</p>
            <p className="text-sm text-muted-foreground mt-0.5">
              Email previews render the actual {templateName} template. Here&apos;s how to keep it in sync.
            </p>
            <div className="flex gap-1 mt-1.5">
              <span className="text-xs bg-muted px-2 py-0.5 rounded-full text-muted-foreground">Email</span>
            </div>
          </div>
        </div>
        {open ? <ChevronUp className="h-4 w-4 text-muted-foreground shrink-0" /> : <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />}
      </button>

      {open && (
        <div className="px-5 pb-5 border-t pt-4 space-y-5">
          <div>
            <p className="text-sm font-medium mb-2">How the preview works</p>
            <p className="text-sm text-muted-foreground leading-relaxed">
              The email preview in the Content Hub renders an <code className="font-mono text-xs bg-muted px-1 rounded">iframe</code> using
              the actual TrustDrivenCare HTML template stored at{' '}
              <code className="font-mono text-xs bg-muted px-1 rounded">src/email-template.html</code> in the repo.
              Each <code className="font-mono text-xs bg-muted px-1 rounded">{'{{merge_tag}}'}</code> is substituted
              with the corresponding section from the generated email before rendering — so what you see in the app
              is exactly what will appear in TDC.
            </p>
          </div>

          <Separator />

          <div>
            <p className="text-sm font-medium mb-2">Updating the template design</p>
            <ol className="space-y-1.5">
              {[
                'In TrustDrivenCare, open the master template and export / copy the full HTML source.',
                'Replace the contents of src/email-template.html with the new HTML.',
                'Make sure all {{merge_tags}} listed below are still present.',
                'Commit and push to main. Vercel will redeploy automatically.',
              ].map((step, i) => (
                <li key={i} className="flex gap-2 text-sm text-muted-foreground">
                  <span className="text-primary font-semibold shrink-0">{i + 1}.</span>
                  {step}
                </li>
              ))}
            </ol>
          </div>

          <Separator />

          <div>
            <p className="text-sm font-medium mb-2">Merge tag reference</p>
            <div className="space-y-1.5">
              {EMAIL_MERGE_TAGS.map(({ tag, desc }) => (
                <div key={tag} className="flex items-start gap-2 group">
                  <button
                    onClick={() => copyTag(tag)}
                    className="shrink-0 font-mono text-xs bg-muted px-2 py-1 rounded border hover:bg-accent transition-colors text-primary min-w-0"
                    title="Click to copy"
                  >
                    {copiedTag === tag ? <span className="text-green-600">✓ copied</span> : tag}
                  </button>
                  <p className="text-xs text-muted-foreground pt-1 leading-tight">{desc}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
