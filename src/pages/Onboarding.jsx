// Phase 1E onboarding wizard. Lives at narraterx.ai/onboard (apex).
//
// Flow:
//   0. Capacity check — silent unless full (then we show a waitlist gate).
//      When spots are open we drop straight into the sign-in/sign-up step
//      with a small "X founding spots left" badge — direct visitors to
//      /onboard found the extra "Get started" interstitial confusing.
//   1. Sign in / sign up (Clerk hosted UI)
//   2. Business basics — display_name, website, location, optional website scan
//   3. Voice context — clinic_context, audience_short, brand_voice (pre-filled by scan)
//   4. Subdomain claim — live availability check
//   5. Channels — pick at least one (none pre-checked)
//   6. Review + submit
//   7. "Setting up your workspace…" loader → redirect to <slug>.narraterx.ai/settings/workspace
//
// The component does NOT use the WorkspaceProvider (no workspace exists yet)
// and does NOT use OrgGate (Clerk Org is created server-side at the claim step).
// Just <ClerkProvider> + <SignedIn/SignedOut>.

import { useState, useEffect, useCallback } from 'react'
import { SignedIn, SignedOut, SignIn, SignUp, useAuth, useUser } from '@clerk/clerk-react'
import { Loader2, CheckCircle2, AlertCircle, ArrowRight, Sparkles, Plus, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { OUTPUT_CHANNELS } from '@/lib/outputChannels'
import { useDocumentTitle } from '@/lib/useDocumentTitle'

export default function Onboarding() {
  useDocumentTitle('Get started')
  const [step, setStep] = useState('loading')
  const [capacity, setCapacity] = useState(null)        // {cap, used, remaining, full}
  const [form, setForm] = useState({
    display_name: '',
    website: '',
    // First entry is the primary location. Additional rows for multi-location
    // practices (e.g. a clinic with two physical sites) — each becomes its own
    // workspace_locations row at claim time.
    locations: [{ label: '', city: '', region: '' }],
    clinic_context: '',
    audience_short: '',
    brand_voice: '',
    slug: '',
    enabled_outputs: [],
  })
  const [scanState, setScanState] = useState({ status: 'idle', error: null, sources: [], recent_topics: [], services: [] })
  const [slugCheck, setSlugCheck] = useState({ status: 'idle', available: null, reason: null })
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState(null)
  const [redirectUrl, setRedirectUrl] = useState(null)

  // 0. Capacity check — runs once on mount. We only block on the response
  //    when spots are full; otherwise we drop straight to the auth step.
  useEffect(() => {
    fetch('/api/onboarding/capacity')
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        const cap = data || { cap: 10, used: 0, remaining: 10, full: false }
        setCapacity(cap)
        setStep(prev => (prev === 'loading' ? (cap.full ? 'capacity-full' : 'auth') : prev))
      })
      .catch(() => {
        setCapacity({ cap: 10, used: 0, remaining: 10, full: false })
        setStep(prev => (prev === 'loading' ? 'auth' : prev))
      })
  }, [])

  const setField = useCallback((key) => (val) => setForm(f => ({ ...f, [key]: val })), [])

  return (
    <div className="min-h-screen bg-background text-foreground">
      <Header />
      <main className="max-w-2xl mx-auto px-6 py-10 space-y-6">
        <ProgressBar step={step} />

        {step === 'loading' && <LoadingScreen />}

        {step === 'capacity-full' && (
          <CapacityFullScreen capacity={capacity} />
        )}

        {step === 'auth' && (
          <AuthScreen
            capacity={capacity}
            onSignedIn={() => setStep('business')}
          />
        )}

        {step === 'business' && (
          <BusinessScreen
            form={form}
            setForm={setForm}
            setField={setField}
            scanState={scanState}
            setScanState={setScanState}
            applyScan={(scan) => setForm(f => {
              const services = Array.isArray(scan.services) ? scan.services : []
              const base = scan.clinic_context || f.clinic_context
              const ctx = services.length
                ? `${base}\n\nServices: ${services.join(', ')}`.trim()
                : base
              return {
                ...f,
                display_name: scan.display_name || f.display_name,
                clinic_context: ctx,
                audience_short: scan.audience_short || f.audience_short,
                brand_voice: scan.brand_voice || f.brand_voice,
              }
            })}
            onContinue={() => setStep('voice')}
          />
        )}

        {step === 'voice' && (
          <VoiceScreen
            form={form}
            setField={setField}
            scanState={scanState}
            onBack={() => setStep('business')}
            onContinue={() => setStep('subdomain')}
          />
        )}

        {step === 'subdomain' && (
          <SubdomainScreen
            form={form}
            setField={setField}
            slugCheck={slugCheck}
            setSlugCheck={setSlugCheck}
            onBack={() => setStep('voice')}
            onContinue={() => setStep('channels')}
          />
        )}

        {step === 'channels' && (
          <ChannelsScreen
            form={form}
            setForm={setForm}
            onBack={() => setStep('subdomain')}
            onContinue={() => setStep('review')}
          />
        )}

        {step === 'review' && (
          <ReviewScreen
            form={form}
            submitting={submitting}
            submitError={submitError}
            onBack={() => setStep('channels')}
            onSubmit={async (token) => {
              setSubmitting(true)
              setSubmitError(null)
              try {
                const r = await fetch('/api/onboarding/claim', {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`,
                  },
                  body: JSON.stringify({
                    slug: form.slug,
                    display_name: form.display_name,
                    website: form.website,
                    locations: form.locations
                      .map(l => ({
                        label: (l.label || '').trim(),
                        city: (l.city || '').trim(),
                        region: (l.region || '').trim(),
                      }))
                      .filter(l => l.city),
                    clinic_context: form.clinic_context,
                    audience_short: form.audience_short,
                    brand_voice: form.brand_voice,
                    enabled_outputs: form.enabled_outputs,
                  }),
                })
                if (!r.ok) {
                  const err = await r.json().catch(() => ({}))
                  setSubmitError(err.error || 'claim-failed')
                  setSubmitting(false)
                  return
                }
                const data = await r.json()
                setRedirectUrl(data.redirect_url)
                setStep('launching')
              } catch {
                setSubmitError('network-error')
                setSubmitting(false)
              }
            }}
          />
        )}

        {step === 'launching' && (
          <LaunchingScreen redirectUrl={redirectUrl} />
        )}
      </main>
    </div>
  )
}

// ── Layout chrome ─────────────────────────────────────────────────────────────

function Header() {
  return (
    <header className="border-b">
      <div className="max-w-2xl mx-auto px-6 py-4 flex items-center justify-between">
        <a href="/" className="font-semibold text-lg">
          <span>narrate</span>
          <span className="text-orange-600">Rx</span>
        </a>
        <a href="/" className="text-xs text-muted-foreground hover:underline">
          ← Back to home
        </a>
      </div>
    </header>
  )
}

const STEP_LABELS = {
  loading: 'Loading',
  'capacity-full': 'Waitlist',
  auth: 'Sign in',
  business: 'Your business',
  voice: 'Brand voice',
  subdomain: 'Choose subdomain',
  channels: 'Pick channels',
  review: 'Review',
  launching: 'Setting up',
}
const VISIBLE_STEPS = ['business', 'voice', 'subdomain', 'channels', 'review']

function ProgressBar({ step }) {
  if (!VISIBLE_STEPS.includes(step)) return null
  const idx = VISIBLE_STEPS.indexOf(step)
  return (
    <div className="flex items-center gap-2">
      {VISIBLE_STEPS.map((s, i) => (
        <div key={s} className="flex-1 flex items-center gap-2">
          <div
            className={`h-1.5 flex-1 rounded-full ${i <= idx ? 'bg-orange-600' : 'bg-muted'}`}
          />
        </div>
      ))}
      <span className="text-[11px] text-muted-foreground ml-2 shrink-0">
        Step {idx + 1} of {VISIBLE_STEPS.length} — {STEP_LABELS[step]}
      </span>
    </div>
  )
}

function Card({ title, subtitle, children, footer }) {
  return (
    <div className="border rounded-xl bg-card text-card-foreground shadow-sm">
      <div className="p-6 space-y-1.5">
        {title && <h1 className="text-xl font-semibold tracking-tight">{title}</h1>}
        {subtitle && <p className="text-sm text-muted-foreground">{subtitle}</p>}
      </div>
      <div className="px-6 pb-6 space-y-4">{children}</div>
      {footer && <div className="px-6 pb-6 pt-2 border-t">{footer}</div>}
    </div>
  )
}

// ── 0. Loading + capacity-full ───────────────────────────────────────────────

function LoadingScreen() {
  return (
    <Card title="Loading…">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Checking founding-owner availability
      </div>
    </Card>
  )
}

function CapacityFullScreen({ capacity }) {
  const cap = capacity?.cap ?? 10
  return (
    <Card
      title="Founding owner spots are full"
      subtitle={`The first ${cap} founding spots are taken. NarrateRx is invite-only beyond founding — drop a note and you'll be first in line when the next cohort opens.`}
    >
      <a
        className="inline-flex items-center gap-1.5 text-sm font-medium text-orange-600 hover:underline"
        href="mailto:drq@narraterx.ai?subject=Waitlist%20%E2%80%94%20NarrateRx"
      >
        Email Dr. Q to join the waitlist <ArrowRight className="h-4 w-4" />
      </a>
    </Card>
  )
}

// ── 1. Auth ───────────────────────────────────────────────────────────────────

// Default mode is 'signup' (most /onboard visitors are new). If the URL hash
// is `#signin` (e.g., from the landing page's "Sign in" link), start on the
// sign-in tab instead.
function initialAuthMode() {
  if (typeof window === 'undefined') return 'signup'
  return window.location.hash.toLowerCase().includes('signin') ? 'signin' : 'signup'
}

function AuthScreen({ capacity, onSignedIn }) {
  const { isSignedIn } = useUser()
  const [mode, setMode] = useState(initialAuthMode)
  const remaining = capacity?.remaining
  const showBadge = typeof remaining === 'number' && remaining > 0

  useEffect(() => {
    if (isSignedIn) onSignedIn()
  }, [isSignedIn, onSignedIn])

  return (
    <Card
      title="Create your account"
      subtitle="One account. Sign back in any time at your workspace's subdomain."
    >
      {showBadge && (
        <div className="inline-flex items-center gap-1.5 rounded-full border border-orange-200 bg-orange-50 px-3 py-1 text-xs font-medium text-orange-700">
          <Sparkles className="h-3.5 w-3.5" />
          {remaining} founding {remaining === 1 ? 'spot' : 'spots'} left · founding price locked in for life
        </div>
      )}
      <SignedOut>
        <div className="flex items-center gap-2 text-xs">
          <button
            type="button"
            onClick={() => setMode('signup')}
            className={`px-3 py-1.5 rounded-md ${mode === 'signup' ? 'bg-orange-600 text-white' : 'bg-muted text-muted-foreground'}`}
          >
            Sign up
          </button>
          <button
            type="button"
            onClick={() => setMode('signin')}
            className={`px-3 py-1.5 rounded-md ${mode === 'signin' ? 'bg-orange-600 text-white' : 'bg-muted text-muted-foreground'}`}
          >
            I already have an account
          </button>
        </div>
        <div>
          {mode === 'signup'
            ? <SignUp routing="hash" appearance={{ elements: { rootBox: 'mx-auto', card: 'shadow-none border' } }} />
            : <SignIn routing="hash" appearance={{ elements: { rootBox: 'mx-auto', card: 'shadow-none border' } }} />}
        </div>
      </SignedOut>
      <SignedIn>
        <SignedInPrompt onContinue={onSignedIn} />
      </SignedIn>
    </Card>
  )
}

function SignedInPrompt({ onContinue }) {
  const { user } = useUser()
  const { getToken } = useAuth()
  const [state, setState] = useState({ status: 'loading', workspaces: [] })

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const token = await getToken()
        const r = await fetch('/api/onboarding/my-workspaces', {
          headers: { Authorization: `Bearer ${token}` },
        })
        if (!r.ok) throw new Error(`status ${r.status}`)
        const data = await r.json()
        if (cancelled) return
        setState({ status: 'done', workspaces: data.workspaces || [] })
      } catch {
        // On error, fall through to the wizard — better to let them create a
        // new workspace than to strand them.
        if (!cancelled) setState({ status: 'done', workspaces: [] })
      }
    })()
    return () => { cancelled = true }
  }, [getToken])

  if (state.status === 'loading') {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Checking your workspaces…
      </div>
    )
  }

  const hasWorkspaces = state.workspaces.length > 0

  return (
    <div className="space-y-4 text-sm">
      <p>Signed in as <span className="font-mono text-xs">{user?.primaryEmailAddress?.emailAddress}</span>.</p>

      {hasWorkspaces && (
        <div className="space-y-2">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">
            Your workspace{state.workspaces.length === 1 ? '' : 's'}
          </p>
          <div className="space-y-1.5">
            {state.workspaces.map(ws => (
              <a
                key={ws.slug}
                href={ws.url}
                className="flex items-center justify-between gap-3 rounded-md border border-input px-3 py-2 hover:bg-accent/30"
              >
                <div className="min-w-0">
                  <div className="font-medium truncate">{ws.display_name || ws.slug}</div>
                  <div className="text-xs text-muted-foreground font-mono truncate">{ws.slug}.narraterx.ai</div>
                </div>
                <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground" />
              </a>
            ))}
          </div>
        </div>
      )}

      <Button onClick={onContinue} variant={hasWorkspaces ? 'secondary' : 'default'}>
        {hasWorkspaces ? 'Create another workspace' : 'Continue'}
        <ArrowRight className="h-4 w-4 ml-1" />
      </Button>
    </div>
  )
}

// ── 2. Business basics + scan ────────────────────────────────────────────────

const SCAN_STATUS_MESSAGES = [
  'Fetching your home page…',
  'Looking for services, treatments, and program pages…',
  'Reading your about and approach pages…',
  'Pulling recent blog posts and articles…',
  'Studying your voice and vocabulary…',
  'Drafting your starter brand context…',
  'Almost done — finalizing suggestions…',
]

function BusinessScreen({ form, setForm, setField, scanState, setScanState, applyScan, onContinue }) {
  const isScanning = scanState.status === 'scanning'
  const canContinue = form.display_name.trim().length > 0
    && form.locations.length > 0 && form.locations[0].city.trim().length > 0
    && !isScanning
  const canScan = /^https?:\/\/.+\..+/.test(form.website.trim()) || /^[^\s]+\.[^\s]+/.test(form.website.trim())

  // Cycle through informational status messages while scanning. The scan is
  // a single round-trip (we can't get true progress) but we know roughly what
  // it's doing in what order, so we tick through messages on a timer to make
  // the wait feel grounded.
  const [scanMessageIdx, setScanMessageIdx] = useState(0)
  const [scanElapsed, setScanElapsed] = useState(0)
  useEffect(() => {
    if (!isScanning) {
      setScanMessageIdx(0)
      setScanElapsed(0)
      return
    }
    const started = Date.now()
    const tick = setInterval(() => {
      const sec = Math.floor((Date.now() - started) / 1000)
      setScanElapsed(sec)
      // ~5s per message, capped at the last one
      setScanMessageIdx(Math.min(Math.floor(sec / 5), SCAN_STATUS_MESSAGES.length - 1))
    }, 500)
    return () => clearInterval(tick)
  }, [isScanning])

  function updateLocation(idx, key, value) {
    setForm(f => ({
      ...f,
      locations: f.locations.map((loc, i) => i === idx ? { ...loc, [key]: value } : loc),
    }))
  }
  function addLocation() {
    setForm(f => ({ ...f, locations: [...f.locations, { label: '', city: '', region: '' }] }))
  }
  function removeLocation(idx) {
    setForm(f => ({
      ...f,
      locations: f.locations.length > 1 ? f.locations.filter((_, i) => i !== idx) : f.locations,
    }))
  }

  async function runScan() {
    setScanState({ status: 'scanning', error: null, sources: [], recent_topics: [], services: [] })
    try {
      const r = await fetch('/api/onboarding/scan-website', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: form.website }),
      })
      if (!r.ok) {
        const err = await r.json().catch(() => ({}))
        setScanState({ status: 'error', error: err.error || 'scan-failed', sources: [], recent_topics: [], services: [] })
        return
      }
      const data = await r.json()
      applyScan(data)
      setScanState({
        status: 'done',
        error: null,
        sources: data.source_pages || [],
        recent_topics: Array.isArray(data.recent_topics) ? data.recent_topics : [],
        services: Array.isArray(data.services) ? data.services : [],
      })
    } catch {
      setScanState({ status: 'error', error: 'network-error', sources: [], recent_topics: [], services: [] })
    }
  }

  return (
    <Card
      title="Tell us about your business"
      subtitle="The basics. You can edit any of this later in workspace settings."
    >
      <FieldRow label="Business name *" hint="What you'd put on a sign.">
        <Input value={form.display_name} onChange={e => setField('display_name')(e.target.value)} placeholder="Acme Movement" autoComplete="organization" />
      </FieldRow>
      <FieldRow label="Website" hint="We can scan it to draft your brand voice — optional but recommended.">
        <Input type="url" value={form.website} onChange={e => setField('website')(e.target.value)} placeholder="https://yourpractice.com" autoComplete="url" />
      </FieldRow>
      <div className="space-y-2">
        <Label className="text-xs">Location *</Label>
        <p className="text-[11px] text-muted-foreground">
          City and state — used in "near me" SEO copy. If your practice has more than one
          location, add each one so each post can target the right city and hashtag.
        </p>
        <div className="space-y-2">
          {form.locations.map((loc, idx) => (
            <div key={idx} className="grid grid-cols-12 gap-2 items-start">
              <div className="col-span-5">
                <Input
                  value={loc.city}
                  onChange={e => updateLocation(idx, 'city', e.target.value)}
                  placeholder={idx === 0 ? 'Portland' : 'Vancouver'}
                  autoComplete="address-level2"
                />
                {idx === 0 && (
                  <p className="text-[10px] text-muted-foreground mt-1">City (primary)</p>
                )}
              </div>
              <div className="col-span-3">
                <Input
                  value={loc.region}
                  onChange={e => updateLocation(idx, 'region', e.target.value)}
                  placeholder={idx === 0 ? 'OR' : 'WA'}
                  autoComplete="address-level1"
                />
                {idx === 0 && (
                  <p className="text-[10px] text-muted-foreground mt-1">State</p>
                )}
              </div>
              <div className="col-span-3">
                <Input
                  value={loc.label}
                  onChange={e => updateLocation(idx, 'label', e.target.value)}
                  placeholder="optional"
                />
                {idx === 0 && (
                  <p className="text-[10px] text-muted-foreground mt-1">Label (optional)</p>
                )}
              </div>
              <div className="col-span-1 flex items-center justify-end pt-1">
                {form.locations.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeLocation(idx)}
                    className="text-muted-foreground hover:text-destructive p-1"
                    aria-label="Remove location"
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
        <button
          type="button"
          onClick={addLocation}
          className="inline-flex items-center gap-1 text-xs text-orange-600 hover:underline"
        >
          <Plus className="h-3.5 w-3.5" /> Add another location
        </button>
      </div>

      <div className="border rounded-md p-3 bg-muted/30 space-y-2">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-orange-600" />
          <p className="text-sm font-medium">Scan your website to draft your voice</p>
        </div>
        <p className="text-xs text-muted-foreground">
          We'll read your home page, your services / treatments / programs
          pages, your about page, and a few blog posts if you have them — then
          propose starter brand voice context grounded in what you actually
          offer and how you actually write. You'll review and edit on the next
          step.
        </p>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={runScan}
            disabled={!canScan || isScanning}
          >
            {isScanning && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />}
            {isScanning ? 'Scanning…' : scanState.status === 'done' ? 'Re-scan' : 'Scan my website'}
          </Button>
          {scanState.status === 'done' && (
            <span className="text-xs text-green-600 inline-flex items-center gap-1">
              <CheckCircle2 className="h-3.5 w-3.5" />
              Read {scanState.sources.length} page{scanState.sources.length === 1 ? '' : 's'}
            </span>
          )}
          {scanState.status === 'error' && (
            <span className="text-xs text-destructive inline-flex items-center gap-1">
              <AlertCircle className="h-3.5 w-3.5" />
              {scanState.error === 'fetch-failed' ? 'Could not load that URL' : scanState.error}
            </span>
          )}
        </div>

        {isScanning && (
          <div className="mt-1 rounded-md border border-orange-200 bg-orange-50 px-3 py-2.5 space-y-2">
            <div className="flex items-start gap-2">
              <Loader2 className="h-4 w-4 animate-spin text-orange-600 mt-0.5 shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-orange-900">
                  {SCAN_STATUS_MESSAGES[scanMessageIdx]}
                </p>
                <p className="text-[11px] text-orange-700 mt-0.5">
                  This usually takes 20–60 seconds. We're reading up to 15 pages from your site.
                  {scanElapsed > 0 && ` (${scanElapsed}s elapsed)`}
                </p>
              </div>
            </div>
            <div className="h-1 w-full overflow-hidden rounded-full bg-orange-100">
              <div className="h-full w-1/3 animate-pulse bg-orange-500 rounded-full" />
            </div>
          </div>
        )}
      </div>

      <div className="flex items-center justify-end gap-3 pt-2">
        {isScanning && (
          <span className="text-xs text-muted-foreground">
            Hang on — finishing the scan before you continue.
          </span>
        )}
        <Button onClick={onContinue} disabled={!canContinue}>
          Continue <ArrowRight className="h-4 w-4 ml-1" />
        </Button>
      </div>
    </Card>
  )
}

// ── 3. Voice context ─────────────────────────────────────────────────────────

const VOICE_PLACEHOLDERS = {
  clinic_context: "We help [audience] with [outcome]. Our approach is [method]. We serve [location/region].",
  audience_short: "Active adults navigating persistent injuries",
  brand_voice: "Plain, direct, conversational. Expert without jargon. We avoid hype words and corporate-speak. We sound like a thoughtful clinician talking — not a marketer pitching.",
}

function VoiceScreen({ form, setField, scanState, onBack, onContinue }) {
  const topics = scanState?.recent_topics || []
  return (
    <Card
      title="Brand voice"
      subtitle="This is what makes the AI sound like you. Write it as if briefing a copywriter. You can edit any of it later."
    >
      <FieldRow label="What you do" hint="1–3 sentences. Your method, who you serve, what makes you distinct.">
        <Textarea
          value={form.clinic_context}
          onChange={e => setField('clinic_context')(e.target.value)}
          rows={3}
          placeholder={VOICE_PLACEHOLDERS.clinic_context}
          className="text-sm"
        />
      </FieldRow>
      <FieldRow label="Audience (short)" hint="One tight phrase. ~10 words.">
        <Input
          value={form.audience_short}
          onChange={e => setField('audience_short')(e.target.value)}
          placeholder={VOICE_PLACEHOLDERS.audience_short}
        />
      </FieldRow>
      <FieldRow label="Brand voice" hint="3–5 sentences on tone, vocabulary, things you avoid.">
        <Textarea
          value={form.brand_voice}
          onChange={e => setField('brand_voice')(e.target.value)}
          rows={5}
          placeholder={VOICE_PLACEHOLDERS.brand_voice}
          className="text-sm"
        />
      </FieldRow>
      {topics.length > 0 && (
        <div className="rounded-md border border-orange-200 bg-orange-50 px-3 py-2.5">
          <p className="text-xs font-medium text-orange-900 mb-1.5">
            We saw you write about:
          </p>
          <div className="flex flex-wrap gap-1.5">
            {topics.map((t, i) => (
              <span
                key={i}
                className="inline-flex items-center rounded-full bg-white border border-orange-200 px-2 py-0.5 text-[11px] text-orange-900"
              >
                {t}
              </span>
            ))}
          </div>
          <p className="text-[11px] text-orange-700 mt-1.5">
            These are topics pulled from your blog. We'll use them later to seed post ideas — you don't need to edit anything here.
          </p>
        </div>
      )}
      <div className="flex items-center justify-between pt-2">
        <Button variant="ghost" onClick={onBack}>← Back</Button>
        <Button onClick={onContinue}>
          Continue <ArrowRight className="h-4 w-4 ml-1" />
        </Button>
      </div>
    </Card>
  )
}

// ── 4. Subdomain ─────────────────────────────────────────────────────────────

function SubdomainScreen({ form, setField, slugCheck, setSlugCheck, onBack, onContinue }) {
  const [debounced, setDebounced] = useState(form.slug)

  useEffect(() => {
    const t = setTimeout(() => setDebounced(form.slug), 300)
    return () => clearTimeout(t)
  }, [form.slug])

  useEffect(() => {
    if (!debounced) {
      setSlugCheck({ status: 'idle', available: null, reason: null })
      return
    }
    let cancelled = false
    setSlugCheck({ status: 'checking', available: null, reason: null })
    fetch('/api/onboarding/check-slug', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slug: debounced }),
    })
      .then(r => r.json())
      .then(data => {
        if (cancelled) return
        setSlugCheck({ status: 'done', available: data.available, reason: data.reason || null })
      })
      .catch(() => {
        if (cancelled) return
        setSlugCheck({ status: 'done', available: false, reason: 'network-error' })
      })
    return () => { cancelled = true }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced])

  const reasonText = {
    'required': 'Required',
    'too-short': 'At least 3 characters',
    'too-long': 'At most 32 characters',
    'invalid-format': 'Lowercase letters, numbers, and hyphens only',
    'reserved': 'That subdomain is reserved',
    'taken': 'That subdomain is taken',
    'db-error': 'Could not check — try again',
    'network-error': 'Network error — try again',
  }

  return (
    <Card
      title="Choose your subdomain"
      subtitle="This is your workspace's URL. You can't change it later — pick something stable."
    >
      <FieldRow label="Subdomain *">
        <div className="flex items-stretch border rounded-md overflow-hidden focus-within:ring-2 focus-within:ring-ring">
          <input
            value={form.slug}
            onChange={e => setField('slug')(e.target.value.toLowerCase())}
            placeholder="acme-movement"
            className="flex-1 px-3 py-2 text-sm bg-transparent outline-none"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck="false"
          />
          <span className="px-3 py-2 text-sm text-muted-foreground bg-muted border-l">
            .narraterx.ai
          </span>
        </div>
        <div className="text-xs h-5 mt-1">
          {slugCheck.status === 'checking' && (
            <span className="text-muted-foreground inline-flex items-center gap-1">
              <Loader2 className="h-3 w-3 animate-spin" /> Checking…
            </span>
          )}
          {slugCheck.status === 'done' && slugCheck.available && (
            <span className="text-green-600 inline-flex items-center gap-1">
              <CheckCircle2 className="h-3.5 w-3.5" /> Available
            </span>
          )}
          {slugCheck.status === 'done' && !slugCheck.available && slugCheck.reason && (
            <span className="text-destructive inline-flex items-center gap-1">
              <AlertCircle className="h-3.5 w-3.5" /> {reasonText[slugCheck.reason] || slugCheck.reason}
            </span>
          )}
        </div>
      </FieldRow>
      <div className="flex items-center justify-between pt-2">
        <Button variant="ghost" onClick={onBack}>← Back</Button>
        <Button onClick={onContinue} disabled={!slugCheck.available}>
          Continue <ArrowRight className="h-4 w-4 ml-1" />
        </Button>
      </div>
    </Card>
  )
}

// ── 5. Channels ──────────────────────────────────────────────────────────────

function ChannelsScreen({ form, setForm, onBack, onContinue }) {
  function toggle(id) {
    setForm(f => {
      const has = f.enabled_outputs.includes(id)
      return {
        ...f,
        enabled_outputs: has
          ? f.enabled_outputs.filter(x => x !== id)
          : [...f.enabled_outputs, id],
      }
    })
  }
  const ok = form.enabled_outputs.length > 0
  return (
    <Card
      title="Pick your channels"
      subtitle="Which outputs will this workspace generate? Each interview will let you pick a subset of these. You can change this any time in settings."
    >
      <div className="space-y-2">
        {Object.values(OUTPUT_CHANNELS).map(channel => {
          const checked = form.enabled_outputs.includes(channel.id)
          return (
            <label
              key={channel.id}
              className="flex items-start gap-2.5 rounded-md border border-input p-2.5 cursor-pointer hover:bg-accent/30"
            >
              <input
                type="checkbox"
                checked={checked}
                onChange={() => toggle(channel.id)}
                className="mt-0.5"
              />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium leading-tight">{channel.label}</div>
                <div className="text-[11px] text-muted-foreground mt-0.5">
                  Export: {channel.exportShape}
                </div>
              </div>
            </label>
          )
        })}
      </div>
      <p className="text-xs text-muted-foreground">
        Pick at least one. Every channel ships with a clean export, and the social channels can be pushed straight to <strong>Buffer</strong> — connect once and NarrateRx queues posts to Instagram, Facebook, LinkedIn, Twitter/X, Threads, Pinterest, and more. Other direct integrations (Google Business Profile, website, newsletter) are reserved for the first-party Move Better workspaces in beta.
      </p>
      <div className="flex items-center justify-between pt-2">
        <Button variant="ghost" onClick={onBack}>← Back</Button>
        <Button onClick={onContinue} disabled={!ok}>
          Continue <ArrowRight className="h-4 w-4 ml-1" />
        </Button>
      </div>
    </Card>
  )
}

// ── 6. Review ────────────────────────────────────────────────────────────────

function ReviewScreen({ form, submitting, submitError, onBack, onSubmit }) {
  const { getToken } = useAuth()
  return (
    <Card
      title="Review and create"
      subtitle="Last check. Subdomain can't be changed later — everything else is editable in settings."
    >
      <ReviewRow label="Workspace name" value={form.display_name} />
      <ReviewRow label="Subdomain" value={`${form.slug}.narraterx.ai`} mono />
      {form.website && <ReviewRow label="Website" value={form.website} />}
      {form.locations.filter(l => l.city.trim()).length > 0 && (
        <ReviewRow
          label={form.locations.filter(l => l.city.trim()).length > 1 ? 'Locations' : 'Location'}
          value={form.locations
            .filter(l => l.city.trim())
            .map(l => [l.city.trim(), l.region.trim()].filter(Boolean).join(', '))
            .join(' · ')}
        />
      )}
      {form.audience_short && <ReviewRow label="Audience" value={form.audience_short} />}
      <ReviewRow label="Channels" value={`${form.enabled_outputs.length} selected`} />
      {submitError && (
        <div className="text-xs text-destructive flex items-center gap-1">
          <AlertCircle className="h-3.5 w-3.5" />
          {submitError === 'slug-taken' && 'That subdomain was just taken. Go back and pick another.'}
          {submitError === 'founding-spots-full' && 'Founding spots filled while you were filling this out. Email us to join the waitlist.'}
          {submitError === 'no-channels-selected' && 'Pick at least one channel.'}
          {submitError === 'org-create-failed' && 'Could not create your workspace org — please try again.'}
          {submitError === 'domain-registration-failed' && 'Could not register your subdomain with our hosting provider. Please try again, or email drq@narraterx.ai if it keeps failing.'}
          {!['slug-taken','founding-spots-full','no-channels-selected','org-create-failed','domain-registration-failed'].includes(submitError) && submitError}
        </div>
      )}
      <div className="flex items-center justify-between pt-2">
        <Button variant="ghost" onClick={onBack} disabled={submitting}>← Back</Button>
        <Button
          onClick={async () => {
            const token = await getToken()
            onSubmit(token)
          }}
          disabled={submitting}
        >
          {submitting && <Loader2 className="h-4 w-4 animate-spin mr-1.5" />}
          Create my workspace <ArrowRight className="h-4 w-4 ml-1" />
        </Button>
      </div>
    </Card>
  )
}

function ReviewRow({ label, value, mono }) {
  return (
    <div className="flex items-baseline justify-between gap-4 text-sm border-b border-input/50 pb-2 last:border-0">
      <span className="text-muted-foreground text-xs uppercase tracking-wide">{label}</span>
      <span className={mono ? 'font-mono' : ''}>{value}</span>
    </div>
  )
}

// ── 7. Launching ─────────────────────────────────────────────────────────────

// Probes the new subdomain via an Image load. Browsers won't resolve the host
// (or will fail TLS) until both DNS and cert provisioning complete, so a
// successful image load is a reliable signal that redirect is safe. Image
// onerror also fires on 404 — fine, since 404 means the cert is good and the
// host responded.
function LaunchingScreen({ redirectUrl }) {
  const [elapsed, setElapsed] = useState(0)
  const [ready, setReady] = useState(false)
  const [timedOut, setTimedOut] = useState(false)
  const [probeKey, setProbeKey] = useState(0)

  useEffect(() => {
    if (!redirectUrl) return
    const host = new URL(redirectUrl).host
    let cancelled = false
    let attempts = 0
    const MAX_ATTEMPTS = 60          // 60 attempts × 1s = ~60s ceiling
    const INTERVAL_MS = 1000

    setElapsed(0)
    setTimedOut(false)

    const tick = () => {
      if (cancelled || ready) return
      attempts += 1
      setElapsed(attempts)
      const img = new Image()
      img.onload = img.onerror = () => {
        if (cancelled) return
        // onload = cert + host both good. onerror with attempts > 1 typically
        // means the cert is good but favicon doesn't exist (404) — still a
        // successful TLS handshake, so safe to redirect.
        if (attempts >= 2 || img.complete) {
          setReady(true)
        }
      }
      img.src = `https://${host}/favicon.ico?probe=${attempts}-${Date.now()}`
      if (attempts < MAX_ATTEMPTS) {
        setTimeout(tick, INTERVAL_MS)
      } else {
        // Out of attempts and still not ready — surface a clear error so the
        // user isn't stuck staring at the spinner.
        setTimeout(() => { if (!cancelled && !ready) setTimedOut(true) }, INTERVAL_MS)
      }
    }
    tick()
    return () => { cancelled = true }
  }, [redirectUrl, ready, probeKey])

  useEffect(() => {
    if (!ready || !redirectUrl) return
    const t = setTimeout(() => { window.location.href = redirectUrl }, 400)
    return () => clearTimeout(t)
  }, [ready, redirectUrl])

  if (timedOut) {
    return (
      <Card
        title="Setup is taking longer than expected"
        subtitle="Your workspace was created, but the SSL certificate for your subdomain isn't responding yet. This usually resolves in another minute or two."
      >
        <div className="text-xs text-destructive flex items-center gap-1">
          <AlertCircle className="h-3.5 w-3.5" />
          Generation is taking longer than expected — try again or check your connection.
        </div>
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <Button
            onClick={() => {
              setReady(false)
              setTimedOut(false)
              setProbeKey((k) => k + 1)
            }}
          >
            Retry
          </Button>
          {redirectUrl && (
            <a className="text-xs underline text-orange-600" href={redirectUrl}>
              Continue manually
            </a>
          )}
        </div>
      </Card>
    )
  }

  return (
    <Card
      title="Setting up your workspace…"
      subtitle="Provisioning your subdomain, creating your org, and wiring up your voice context. New subdomains take about 10–30 seconds for the SSL certificate to issue."
    >
      <div className="flex items-center gap-3 text-sm text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin text-orange-600" />
        <span>
          {ready
            ? `Redirecting to ${redirectUrl ? new URL(redirectUrl).host : ''}…`
            : `Waiting for SSL certificate (${elapsed}s)…`}
        </span>
      </div>
      {!ready && elapsed >= 25 && redirectUrl && (
        <p className="text-xs text-muted-foreground">
          Taking longer than usual? You can also{' '}
          <a className="underline text-orange-600" href={redirectUrl}>continue manually</a>.
        </p>
      )}
    </Card>
  )
}

// ── helpers ──────────────────────────────────────────────────────────────────

function FieldRow({ label, hint, children }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      {children}
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  )
}
