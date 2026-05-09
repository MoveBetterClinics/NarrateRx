import { useState } from 'react'
import { ExternalLink, CheckCircle2, AlertCircle, Loader2, ChevronDown, ChevronUp, Mail } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { workspace } from '@/lib/workspace'

const INTEGRATIONS = [
  {
    id: 'buffer',
    name: 'Buffer',
    description: 'Schedule and publish to Instagram and LinkedIn.',
    platforms: ['Instagram', 'LinkedIn'],
    envVars: [{ key: 'BUFFER_ACCESS_TOKEN', label: 'Buffer Access Token', placeholder: 'access_token_...' }],
    setupSteps: [
      'Go to buffer.com and create a free account.',
      'Connect your Instagram and LinkedIn pages inside Buffer.',
      'Go to buffer.com/developers/apps → Create an app.',
      'Copy the Access Token from your app settings.',
      'Paste it in the field below and add it to Vercel (see instructions).',
    ],
    docsUrl: 'https://buffer.com/developers/api',
  },
  {
    id: 'facebook',
    name: 'Facebook Page',
    description: `Post directly to your ${workspace.name} Facebook Page.`,
    platforms: ['Facebook'],
    envVars: [
      { key: 'FACEBOOK_PAGE_ID',    label: 'Page ID',           placeholder: '123456789' },
      { key: 'FACEBOOK_PAGE_TOKEN', label: 'Page Access Token', placeholder: 'EAABsbCS...' },
    ],
    setupSteps: [
      'Go to developers.facebook.com → Create App → Business type.',
      'Add the "Pages" product to your app.',
      'Go to Tools → Graph API Explorer.',
      'Select your app and Page, request pages_manage_posts permission.',
      'Generate a long-lived Page Access Token.',
      'Your Page ID is in your Facebook Page URL or About section.',
    ],
    docsUrl: 'https://developers.facebook.com/docs/pages/getting-started',
  },
  {
    id: 'gbp',
    name: 'Google Business Profile',
    description: `Post updates directly to your ${workspace.name} GBP listing.`,
    platforms: ['Google Business Profile'],
    envVars: [
      { key: 'GBP_ACCOUNT_ID',     label: 'Account ID',                        placeholder: 'accounts/123456789' },
      { key: 'GBP_LOCATION_IDS',   label: 'Location IDs (comma-separated)',     placeholder: 'locations/111,locations/222' },
      { key: 'GBP_LOCATION_NAMES', label: 'Location Names (comma-separated)',   placeholder: 'Seattle,Bellevue' },
    ],
    setupSteps: [
      'Go to console.cloud.google.com → Create a project.',
      'Enable the "Business Information API" and "Profile Performance API".',
      'Create a Service Account under IAM & Admin → Service Accounts.',
      'Give it the "Editor" role. Download the JSON key.',
      'Share your Google Business Profile with the service account email (add it as a Manager for each location).',
      'Find your Account ID and Location IDs via the GBP API or Google Business dashboard URL.',
      'Add GOOGLE_SERVICE_ACCOUNT_EMAIL and GOOGLE_SERVICE_ACCOUNT_KEY (from the JSON key) to Vercel.',
      'GBP_LOCATION_IDS and GBP_LOCATION_NAMES must be in the same order — e.g. "locations/111,locations/222" and "Seattle,Bellevue".',
    ],
    docsUrl: 'https://developers.google.com/my-business/content/get-started',
  },
]

const EMAIL_MERGE_TAGS = [
  { tag: '{{preview_text}}',    desc: 'Inbox snippet shown below the subject line (50–90 chars)' },
  { tag: '{{headline}}',        desc: 'Large bold heading at the top of the email body' },
  { tag: '{{pull_quote}}',      desc: 'Styled green callout block — most compelling line from the piece' },
  { tag: '{{body_paragraph_1}}', desc: 'Opening hook paragraph' },
  { tag: '{{body_paragraph_2}}', desc: `${workspace.name} perspective paragraph` },
  { tag: '{{body_paragraph_3}}', desc: 'Patient story + bridge to action paragraph' },
  { tag: '{{cta_text}}',        desc: 'Button label only (e.g. "Book a Free Consultation")' },
  { tag: '{{cta_url}}',         desc: 'Button destination URL' },
  { tag: '{{ps_text}}',         desc: 'Optional P.S. line after the CTA' },
  { tag: '{{hero_image_url}}',  desc: 'Full URL of the hero image shown below the header' },
  { tag: '{{year}}',            desc: 'Auto-filled — current year for the copyright line' },
  { tag: '{{unsubscribe_url}}', desc: 'Auto-filled by TrustDrivenCare at send time' },
  { tag: '{{webview_url}}',     desc: 'Auto-filled by TrustDrivenCare at send time' },
]

export default function Integrations() {
  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Integrations</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Connect publishing platforms. All credentials are stored as Vercel environment variables — never in the browser.
        </p>
      </div>

      <div className="rounded-lg border bg-muted/40 px-4 py-3 flex items-start gap-3">
        <AlertCircle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
        <p className="text-sm text-muted-foreground">
          After adding any env var to Vercel, go to <strong>Vercel → Deployments → Redeploy</strong> for it to take effect.
        </p>
      </div>

      <div className="space-y-4">
        {INTEGRATIONS.map((integration) => (
          <IntegrationCard key={integration.id} integration={integration} />
        ))}
      </div>

      {/* TrustDrivenCare email template section */}
      <TrustDrivenCareCard />
    </div>
  )
}

function IntegrationCard({ integration }) {
  const [open, setOpen] = useState(false)

  return (
    <div className="rounded-xl border bg-card overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-5 py-4 hover:bg-accent/30 transition-colors text-left"
      >
        <div className="flex items-start gap-3">
          <div>
            <p className="font-medium">{integration.name}</p>
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
          {/* Setup steps */}
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
            <a
              href={integration.docsUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs text-primary mt-2 hover:underline"
            >
              Full documentation <ExternalLink className="h-3 w-3" />
            </a>
          </div>

          <Separator />

          {/* Env vars */}
          <div>
            <p className="text-sm font-medium mb-3">Vercel environment variables to add</p>
            <div className="space-y-3">
              {integration.envVars.map(({ key, label, placeholder }) => (
                <VercelEnvRow key={key} envKey={key} label={label} placeholder={placeholder} />
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function VercelEnvRow({ envKey, label, placeholder }) {
  const [copied, setCopied] = useState(false)

  function copyKey() {
    navigator.clipboard.writeText(envKey)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div className="flex items-end gap-2">
      <div className="flex-1 space-y-1">
        <Label className="text-xs text-muted-foreground">{label}</Label>
        <div className="flex gap-1.5">
          <code
            className="flex-1 text-xs bg-muted px-3 py-2 rounded-md font-mono border cursor-pointer hover:bg-accent transition-colors"
            onClick={copyKey}
            title="Click to copy variable name"
          >
            {envKey}
          </code>
          <Button variant="outline" size="sm" className="text-xs shrink-0" onClick={copyKey}>
            {copied ? <CheckCircle2 className="h-3.5 w-3.5 text-green-600" /> : 'Copy name'}
          </Button>
        </div>
        <p className="text-[11px] text-muted-foreground">Value example: <code className="font-mono">{placeholder}</code></p>
      </div>
    </div>
  )
}

function TrustDrivenCareCard() {
  const [open, setOpen] = useState(false)
  const [copiedTag, setCopiedTag] = useState(null)

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
              Email previews render the actual {workspace.newsletterTemplateName} template. Here's how to keep it in sync.
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

          {/* How it works */}
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

          {/* Updating the template */}
          <div>
            <p className="text-sm font-medium mb-2">Updating the template design</p>
            <p className="text-sm text-muted-foreground mb-3">
              When you update the <strong>{workspace.newsletterTemplateName.replace(' - ', ' · ')}</strong> template in TrustDrivenCare, do the following to keep the preview in sync:
            </p>
            <ol className="space-y-1.5">
              {[
                'In TrustDrivenCare, open the master template and export / copy the full HTML source.',
                'Open the repo in your code editor and replace the contents of src/email-template.html with the new HTML.',
                'Make sure all {{merge_tags}} listed below are still present in the new HTML — TDC should preserve them.',
                'Commit the file and push to main. Vercel will redeploy automatically.',
                'No other code changes are needed — the preview will immediately reflect the new design.',
              ].map((step, i) => (
                <li key={i} className="flex gap-2 text-sm text-muted-foreground">
                  <span className="text-primary font-semibold shrink-0">{i + 1}.</span>
                  {step}
                </li>
              ))}
            </ol>
          </div>

          <Separator />

          {/* Merge tags reference */}
          <div>
            <p className="text-sm font-medium mb-2">Merge tag reference</p>
            <p className="text-xs text-muted-foreground mb-3">
              These tags are filled automatically by the app when rendering the preview and when you copy content into TDC.
            </p>
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

          <div className="rounded-lg border border-blue-100 bg-blue-50 px-4 py-3 flex items-start gap-3">
            <AlertCircle className="h-4 w-4 text-blue-500 shrink-0 mt-0.5" />
            <p className="text-xs text-blue-700">
              The <code className="font-mono">{'{{unsubscribe_url}}'}</code> and <code className="font-mono">{'{{webview_url}}'}</code> tags
              are set to <code className="font-mono">#</code> in the preview. TrustDrivenCare replaces them automatically at send time.
            </p>
          </div>

        </div>
      )}
    </div>
  )
}
