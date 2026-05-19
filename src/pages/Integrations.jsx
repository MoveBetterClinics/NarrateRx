import { useEffect, useState } from 'react'
import { useAuth } from '@clerk/clerk-react'
import {
  ExternalLink,
  AlertCircle,
  ChevronDown,
  ChevronUp,
  Sparkles,
  Mail,
} from 'lucide-react'
import { Separator } from '@/components/ui/separator'
import CredentialForm from '@/components/CredentialForm'
import { useWorkspace } from '@/lib/WorkspaceContext'
import { useUserRole } from '@/lib/useUserRole'
import { useDocumentTitle } from '@/lib/useDocumentTitle'
import { apiFetch } from '@/lib/api'

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
    capabilityKey: 'websitePublish',
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
    capabilityKey: 'websitePublish',
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
