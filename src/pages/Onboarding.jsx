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
//   6. Capture setup — video capture is on by default; user sets their display
//      name for content (seeds the founding clinician row at claim time)
//   7. Review + submit
//   8. "Setting up your workspace…" loader → redirect to <slug>.narraterx.ai/settings/workspace
//
// The component does NOT use the WorkspaceProvider (no workspace exists yet)
// and does NOT use OrgGate (Clerk Org is created server-side at the claim step).
// Just <ClerkProvider> + a plain isLoaded/isSignedIn conditional (Clerk v6's
// <Show> is an authorization gate, not a boolean conditional — see AuthScreen).

import { useState, useEffect, useCallback, useRef } from 'react'
import { SignIn, SignUp, useAuth, useUser, useOrganizationList } from '@clerk/react'
import { Loader2, CheckCircle2, AlertCircle, ArrowRight, Sparkles, Plus, X, Clapperboard, Smartphone } from 'lucide-react'
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
    // capture_name: the founding user's display name for content — seeds the
    // clinicians row at claim time. Defaults to their Clerk firstName + lastName;
    // editable in the Capture step. video_pipeline_enabled is always true for
    // new tenants; the wizard just makes it visible and configurable.
    capture_name: '',
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
      <main className="w-full px-6 sm:px-10 lg:px-16 py-10 space-y-6">
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
            onContinue={() => setStep('capture')}
          />
        )}

        {step === 'capture' && (
          <CaptureScreen
            form={form}
            setField={setField}
            onBack={() => setStep('channels')}
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
                    capture_name: form.capture_name || form.display_name,
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
      <div className="w-full px-6 sm:px-10 lg:px-16 py-4 flex items-center justify-between">
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
  capture: 'Capture setup',
  review: 'Review',
  launching: 'Setting up',
}
const VISIBLE_STEPS = ['business', 'voice', 'subdomain', 'channels', 'capture', 'review']

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
      <span className="text-2xs text-muted-foreground ml-2 shrink-0">
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
    <Card title="Just a moment…" subtitle="Checking if founding-owner spots are still open.">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin text-orange-600" />
        Loading
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
  const { isSignedIn, isLoaded } = useUser()
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
      {/* Clerk v6's <Show> is an authorization gate, not a boolean conditional —
          a boolean `when` falls through to the signed-out fallback and renders
          nothing, so we gate on isLoaded/isSignedIn directly. (PR fixing the
          onboarding first-screen blank state after the Core 3 upgrade.) */}
      {!isLoaded ? null : !isSignedIn ? (
        <>
        {/* "What you'll need" pre-screen so brand-new users don't bail mid-flow.
            Shown only to signed-out users — returning users skip it. */}
        <div className="rounded-md border bg-muted/40 p-3 text-xs space-y-1.5">
          <div className="font-semibold text-foreground">Before you start</div>
          <ul className="list-disc list-inside text-muted-foreground space-y-0.5">
            <li>About 5 minutes to fill in your business + voice setup</li>
            <li>Your website URL (we&apos;ll auto-extract what we can)</li>
            <li>A subdomain you want (e.g. <code className="px-1 py-0.5 rounded bg-background border text-3xs">yourclinic</code>.narraterx.ai)</li>
            <li>Logo + brand colors come later — not blocking</li>
          </ul>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <button
            type="button"
            onClick={() => setMode('signup')}
            className={`px-3 py-1.5 rounded-md ${mode === 'signup' ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'}`}
          >
            Sign up
          </button>
          <button
            type="button"
            onClick={() => setMode('signin')}
            className={`px-3 py-1.5 rounded-md ${mode === 'signin' ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'}`}
          >
            I already have an account
          </button>
        </div>
        <div>
          {mode === 'signup'
            ? <SignUp routing="hash" appearance={{ elements: { rootBox: 'mx-auto', card: 'shadow-none border' } }} />
            : <SignIn routing="hash" appearance={{ elements: { rootBox: 'mx-auto', card: 'shadow-none border' } }} />}
        </div>
        </>
      ) : (
        <SignedInPrompt onContinue={onSignedIn} />
      )}
    </Card>
  )
}

function SignedInPrompt({ onContinue }) {
  const { user } = useUser()
  const { getToken } = useAuth()
  // Client-side view of the user's org memberships. Clerk hydrates this from the
  // session immediately, well before the server-side getOrganizationMembershipList
  // API (used by /api/onboarding/my-workspaces) reflects a just-accepted invite.
  // We use it to tell "membership hasn't propagated to the server yet" (poll)
  // apart from "genuinely brand-new user" (go straight to the wizard, no delay).
  const { isLoaded: orgsLoaded, userMemberships } = useOrganizationList({
    userMemberships: { infinite: true },
  })
  const clientMemberCount = userMemberships?.data?.length ?? 0
  const [state, setState] = useState({ status: 'loading', workspaces: [], suggested: [] })
  // One-shot guard: the poll runs exactly once per mount. Without it, the
  // paginated useOrganizationList subscription updating clientMemberCount
  // mid-poll would re-enter the effect, cancel the in-flight run, and restart
  // from attempt 0 — extending latency or settling on the wrong state.
  const startedRef = useRef(false)

  useEffect(() => {
    // Wait until Clerk's client-side membership list has loaded before deciding
    // anything. Bailing while !orgsLoaded would route a just-invited user (whose
    // memberships haven't hydrated yet) straight to the wizard. The effect
    // re-runs when orgsLoaded flips true; startedRef ensures the loop body below
    // executes only once.
    if (!orgsLoaded || startedRef.current) return
    startedRef.current = true

    // Snapshot the client membership count at start — its later mutation must
    // not affect a poll already in flight.
    const hasClientMembership = clientMemberCount > 0
    let cancelled = false

    async function fetchOnce() {
      const token = await getToken()
      const r = await fetch('/api/onboarding/my-workspaces', {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!r.ok) throw new Error(`status ${r.status}`)
      const data = await r.json()
      return { workspaces: data.workspaces || [], suggested: data.suggested || [] }
    }

    ;(async () => {
      // Right after accepting a Clerk org invite, the server's membership list
      // can lag the client's by a few seconds, so a single check returns zero
      // workspaces and strands the invited user in the new-tenant wizard. When
      // the client session shows the user DOES belong to an org but the server
      // hasn't caught up, poll briefly before falling through. A truly new user
      // (no client memberships) skips the poll entirely — no added latency.
      const MAX_ATTEMPTS = 6        // 1 immediate check + up to 5×1s retries ≈ 5s
      const RETRY_MS = 1000
      try {
        for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
          const { workspaces, suggested } = await fetchOnce()
          if (cancelled) return

          // Happy path: exactly one membership means we know where they belong.
          // Skip the click-through entirely — the user just accepted an org
          // invite and shouldn't have to think about "your workspace" pickers or
          // "create another workspace" buttons that historically lured them into
          // the new-tenant wizard.
          if (workspaces.length === 1) {
            setState({ status: 'redirecting', workspaces, suggested })
            window.location.href = workspaces[0].url
            return
          }

          // Multiple memberships, a domain suggestion, or a settled brand-new
          // user — nothing to wait for; show the appropriate UI.
          if (workspaces.length > 1 || suggested.length > 0) {
            setState({ status: 'done', workspaces, suggested })
            return
          }

          // workspaces.length === 0. Only keep polling if the client session
          // says the user belongs to an org the server hasn't surfaced yet.
          const shouldPoll = hasClientMembership && attempt < MAX_ATTEMPTS - 1
          if (!shouldPoll) {
            setState({ status: 'done', workspaces, suggested })
            return
          }
          await new Promise((resolve) => { setTimeout(resolve, RETRY_MS) })
          if (cancelled) return
        }
      } catch {
        // On error, fall through to the wizard — better to let them create a
        // new workspace than to strand them.
        if (!cancelled) setState({ status: 'done', workspaces: [], suggested: [] })
      }
    })()
    return () => { cancelled = true }
  }, [getToken, orgsLoaded, clientMemberCount])

  if (state.status === 'loading') {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Checking your workspaces…
      </div>
    )
  }

  if (state.status === 'redirecting') {
    const ws = state.workspaces[0]
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Taking you to {ws?.display_name || ws?.slug || 'your workspace'}…
      </div>
    )
  }

  const hasWorkspaces = state.workspaces.length > 0
  const hasSuggested = state.suggested.length > 0

  // Domain match found but user isn't a member yet: this is the
  // "alli@movebetter.co signing up while movebetter-people already exists"
  // path. Show "your team already has a workspace — ask the admin" and do NOT
  // offer a continue-to-wizard button. Server-side guard in /api/onboarding/claim
  // also blocks the POST, so a determined user can't bypass this UI.
  if (hasSuggested && !hasWorkspaces) {
    return (
      <div className="space-y-4 text-sm">
        <p>Signed in as <span className="font-mono text-xs">{user?.primaryEmailAddress?.emailAddress}</span>.</p>
        <div className="space-y-2">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">
            Your team already has a workspace
          </p>
          <div className="space-y-1.5">
            {state.suggested.map(ws => (
              <div
                key={ws.slug}
                className="flex items-center justify-between gap-3 rounded-md border border-input px-3 py-2 bg-muted/30"
              >
                <div className="min-w-0">
                  <div className="font-medium truncate" title={ws.display_name || ws.slug}>{ws.display_name || ws.slug}</div>
                  <div className="text-xs text-muted-foreground font-mono truncate">{ws.slug}.narraterx.ai</div>
                </div>
              </div>
            ))}
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed pt-1">
            We can&apos;t put you on this workspace automatically — your team admin needs to invite you. Ask them to add{' '}
            <span className="font-mono">{user?.primaryEmailAddress?.emailAddress}</span> from their settings, then sign in at the workspace URL above. Stuck?{' '}
            <a className="underline" href="mailto:support@narraterx.ai">support@narraterx.ai</a>
          </p>
        </div>
      </div>
    )
  }

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
                  <div className="font-medium truncate" title={ws.display_name || ws.slug}>{ws.display_name || ws.slug}</div>
                  <div className="text-xs text-muted-foreground font-mono truncate" title={`${ws.slug}.narraterx.ai`}>{ws.slug}.narraterx.ai</div>
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
        <Label className="text-xs">Where is your practice? *</Label>
        <p className="text-2xs text-muted-foreground">
          Your city and state. We use this so your posts mention the right area
          and help nearby patients find you. Have more than one office? Add each
          one below.
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
                  <p className="text-3xs text-muted-foreground mt-1">City (primary)</p>
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
                  <p className="text-3xs text-muted-foreground mt-1">State</p>
                )}
              </div>
              <div className="col-span-3">
                <Input
                  value={loc.label}
                  onChange={e => updateLocation(idx, 'label', e.target.value)}
                  placeholder="optional"
                />
                {idx === 0 && (
                  <p className="text-3xs text-muted-foreground mt-1">Label (optional)</p>
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
          We&apos;ll read your home page, your services / treatments / programs
          pages, your about page, and a few blog posts if you have them — then
          propose starter brand voice context grounded in what you actually
          offer and how you actually write. You&apos;ll review and edit on the next
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
                <p className="text-2xs text-orange-700 mt-0.5">
                  This usually takes 20–60 seconds. We&apos;re reading up to 15 pages from your site.
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
  // Require at least "what you do" — it drives every generated post and the
  // onboarding interview context. audience_short and brand_voice are strongly
  // encouraged but skippable (the interview refines them). Without this guard
  // a tenant can click straight through and get blank-context content.
  const canContinue = form.clinic_context.trim().length >= 10
  return (
    <Card
      title="How you sound"
      subtitle="This is the most important step — it's what makes every draft sound like you and not generic AI. Don't worry about getting it perfect; you can change all of it later."
    >
      {/* Voice-fidelity promise — sets the right expectation before the user
          touches any fields. Everything generated traces back to these inputs. */}
      <div className="rounded-xl border-2 border-orange-300 bg-orange-50 px-4 py-4 flex items-start gap-3 -mt-1 shadow-sm">
        <span className="text-2xl mt-0.5 shrink-0">🎙</span>
        <div className="space-y-1">
          <p className="text-sm font-semibold text-orange-900">
            Why this matters most
          </p>
          <p className="text-xs text-orange-900 leading-relaxed">
            Everything NarrateRx writes traces back to what you and your team actually say. The few lines below are what keep your drafts sounding like your practice — your words, your tone — instead of generic AI content. When you review a draft, you&apos;ll see exactly which phrases came from your own answers and which the AI filled in.
          </p>
        </div>
      </div>

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
                className="inline-flex items-center rounded-full bg-white border border-orange-200 px-2 py-0.5 text-2xs text-orange-900"
              >
                {t}
              </span>
            ))}
          </div>
          <p className="text-2xs text-orange-700 mt-1.5">
            These are topics pulled from your blog. We&apos;ll use them later to seed post ideas — you don&apos;t need to edit anything here.
          </p>
        </div>
      )}
      {!canContinue && form.clinic_context.trim().length > 0 && (
        <p className="text-2xs text-destructive">
          Add a bit more detail about what you do (at least 10 characters).
        </p>
      )}
      <p className="text-2xs text-muted-foreground">
        You can edit all of this any time in Settings — and the quick founder
        interview after setup sharpens it for you automatically.
      </p>
      <div className="flex items-center justify-between pt-2">
        <Button variant="ghost" onClick={onBack}>← Back</Button>
        <Button onClick={onContinue} disabled={!canContinue}>
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
    'reserved': 'That address is reserved',
    'taken': 'That address is taken',
    'db-error': 'Could not check — try again',
    'network-error': 'Network error — try again',
  }

  return (
    <Card
      title="Pick your private workspace address"
      subtitle="This is the web address you and your team use to sign in — like your own private login page. Patients and the public never see it. Pick something stable: it can't be changed later."
    >
      <FieldRow label="Your workspace address *">
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
  // Human label for the export affordance each channel produces by default.
  const EXPORT_LABEL = {
    markdown: 'Copy & paste anywhere',
    html_email: 'Copy a ready-to-send email',
    social_compose: 'Copy the caption + download the image',
  }
  // Channels whose publishMode can be upgraded to one-click publishing once an
  // integration is connected (Buffer for social/GBP, WordPress/Astro for blog,
  // newsletter for email). null publishMode = export-only by design.
  const UPGRADE_HINT = {
    buffer: 'Publishes via Buffer once connected',
    website: 'Publishes to your site once connected',
    tdc: 'Sends via your newsletter once connected',
  }
  return (
    <Card
      title="Pick your channels"
      subtitle="Which outputs will this workspace generate? Each interview lets you pick a subset. You can change this any time in settings."
    >
      <div className="rounded-lg border border-orange-200 bg-orange-50 px-3.5 py-2.5 text-xs text-orange-900 leading-relaxed">
        Every channel works as a <strong>clean export</strong> from day one — copy the caption, download the image, paste it wherever you post. Connect an integration later (starting with <strong>Buffer</strong>) and those channels upgrade to one-click publishing.
      </div>
      <div className="space-y-2">
        {Object.values(OUTPUT_CHANNELS).map(channel => {
          const checked = form.enabled_outputs.includes(channel.id)
          const upgrade = channel.publishMode ? UPGRADE_HINT[channel.publishMode] : null
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
                <div className="text-2xs text-muted-foreground mt-0.5">
                  {EXPORT_LABEL[channel.exportShape] || 'Copy & paste anywhere'}
                  {upgrade ? ` · ${upgrade}` : ''}
                </div>
              </div>
            </label>
          )
        })}
      </div>
      <p className="text-xs text-muted-foreground">
        Pick at least one. Buffer fans social posts out to Instagram, Facebook, LinkedIn, Twitter/X, Threads, Pinterest, and more. You don&apos;t need any of this set up to start — export works immediately.
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

// ── 6. Capture setup ─────────────────────────────────────────────────────────

function CaptureScreen({ form, setField, onBack, onContinue }) {
  const { user } = useUser()

  // Pre-fill capture_name from Clerk on first render if still empty.
  useEffect(() => {
    if (!form.capture_name) {
      const name = [user?.firstName, user?.lastName].filter(Boolean).join(' ').trim()
      if (name) setField('capture_name')(name)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id])

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold">Your capture companion is ready</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Video capture is included for all workspaces. Add NarrateRx to your iPhone home
          screen and start capturing clips in seconds — no separate app to install.
        </p>
      </div>

      {/* Feature bullets */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {[
          { icon: Smartphone, label: 'iPhone capture app', body: 'Add to Home Screen via Safari — opens straight to camera.' },
          { icon: Clapperboard, label: 'Fresh drafts each day', body: 'Your clips turn into ready-to-review draft posts you can check each morning.' },
          { icon: CheckCircle2, label: 'You approve every post', body: 'Nothing publishes without your sign-off. Auto-publish is opt-in, channel by channel.' },
          { icon: Sparkles, label: 'Sounds like you, by default', body: 'Drafts keep your words, your views, and your tone — and point out anything that doesn\'t sound like you before it goes out.' },
        ].map(({ icon: Icon, label, body }) => (
          <div key={label} className="flex gap-3 rounded-lg border bg-muted/30 p-3">
            <Icon className="h-4 w-4 text-primary mt-0.5 shrink-0" />
            <div>
              <p className="text-sm font-medium leading-snug">{label}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{body}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Capture name */}
      <div className="space-y-1.5">
        <Label htmlFor="capture-name">Your name in content</Label>
        <Input
          id="capture-name"
          value={form.capture_name}
          onChange={e => setField('capture_name')(e.target.value)}
          placeholder="e.g. Dr. Smith"
          maxLength={80}
        />
        <p className="text-xs text-muted-foreground">
          How your name appears in captions, social posts, and GBP updates.
          You can change this later from your staff profile.
        </p>
      </div>

      <div className="flex justify-between pt-2">
        <Button variant="outline" onClick={onBack}>Back</Button>
        <Button
          onClick={onContinue}
          disabled={!form.capture_name.trim()}
        >
          Continue <ArrowRight className="ml-1.5 h-4 w-4" />
        </Button>
      </div>
    </div>
  )
}

// ── 7. Review ────────────────────────────────────────────────────────────────

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
          {submitError === 'domain-already-claimed' && 'A workspace at this domain already exists. Ask your team admin to invite you, or email support@narraterx.ai.'}
          {!['slug-taken','founding-spots-full','no-channels-selected','org-create-failed','domain-registration-failed','domain-already-claimed'].includes(submitError) && submitError}
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
          Subdomain activation is taking longer than expected — try again or check your connection.
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
      subtitle="Provisioning your subdomain and wiring up your voice context. This usually takes 5–15 seconds."
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
      {hint && <p className="text-2xs text-muted-foreground">{hint}</p>}
    </div>
  )
}
