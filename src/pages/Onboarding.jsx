// Phase 1E onboarding wizard. Lives at narraterx.ai/onboard (apex).
//
// Flow:
//   0. Capacity gate — show "X founding spots left" or "spots full"
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

import { useState, useEffect, useMemo, useCallback } from 'react'
import { SignedIn, SignedOut, SignIn, SignUp, useAuth, useUser } from '@clerk/clerk-react'
import { Loader2, CheckCircle2, AlertCircle, ArrowRight, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { OUTPUT_CHANNELS } from '@/lib/outputChannels'

const STEPS = ['capacity', 'auth', 'business', 'voice', 'subdomain', 'channels', 'review', 'launching']

export default function Onboarding() {
  const [step, setStep] = useState('capacity')
  const [capacity, setCapacity] = useState(null)        // {cap, used, remaining, full}
  const [form, setForm] = useState({
    display_name: '',
    website: '',
    location: '',
    clinic_context: '',
    audience_short: '',
    brand_voice: '',
    slug: '',
    enabled_outputs: [],
  })
  const [scanState, setScanState] = useState({ status: 'idle', error: null, sources: [] })
  const [slugCheck, setSlugCheck] = useState({ status: 'idle', available: null, reason: null })
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState(null)
  const [redirectUrl, setRedirectUrl] = useState(null)

  // 0. Capacity check
  useEffect(() => {
    fetch('/api/onboarding/capacity')
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        setCapacity(data || { cap: 10, used: 0, remaining: 10, full: false })
        setStep(prev => prev === 'capacity' ? (data?.full ? 'capacity' : 'auth') : prev)
      })
      .catch(() => {
        setCapacity({ cap: 10, used: 0, remaining: 10, full: false })
        setStep('auth')
      })
  }, [])

  const setField = useCallback((key) => (val) => setForm(f => ({ ...f, [key]: val })), [])

  return (
    <div className="min-h-screen bg-background text-foreground">
      <Header />
      <main className="max-w-2xl mx-auto px-6 py-10 space-y-6">
        <ProgressBar step={step} />

        {step === 'capacity' && (
          <CapacityScreen
            capacity={capacity}
            onContinue={() => setStep('auth')}
          />
        )}

        {step === 'auth' && (
          <AuthScreen onSignedIn={() => setStep('business')} />
        )}

        {step === 'business' && (
          <BusinessScreen
            form={form}
            setField={setField}
            scanState={scanState}
            setScanState={setScanState}
            applyScan={(scan) => setForm(f => ({
              ...f,
              display_name: scan.display_name || f.display_name,
              clinic_context: scan.clinic_context || f.clinic_context,
              audience_short: scan.audience_short || f.audience_short,
              brand_voice: scan.brand_voice || f.brand_voice,
            }))}
            onContinue={() => setStep('voice')}
          />
        )}

        {step === 'voice' && (
          <VoiceScreen
            form={form}
            setField={setField}
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
                    location: form.location,
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
              } catch (e) {
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
  capacity: 'Founding spots',
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

// ── 0. Capacity ───────────────────────────────────────────────────────────────

function CapacityScreen({ capacity, onContinue }) {
  if (!capacity) {
    return (
      <Card title="Loading…">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Checking founding-owner availability
        </div>
      </Card>
    )
  }

  if (capacity.full) {
    return (
      <Card
        title="Founding owner spots are full"
        subtitle={`The first ${capacity.cap} founding spots are taken. NarrateRx is invite-only beyond founding — drop a note and you'll be first in line when the next cohort opens.`}
      >
        <a
          className="inline-flex items-center gap-1.5 text-sm font-medium text-orange-600 hover:underline"
          href="mailto:drq@movebetter.co?subject=Waitlist%20%E2%80%94%20NarrateRx"
        >
          Email Dr. Q to join the waitlist <ArrowRight className="h-4 w-4" />
        </a>
      </Card>
    )
  }

  return (
    <Card
      title={`${capacity.remaining} founding owner ${capacity.remaining === 1 ? 'spot' : 'spots'} left`}
      subtitle="Founding owners get a permanent founding price (locked in when pricing launches), personal onboarding from Dr. Q, and a direct line — not a support queue."
    >
      <div className="text-sm space-y-2">
        <p>You're about to set up your NarrateRx workspace. It takes about 5 minutes.</p>
        <ul className="list-disc list-inside text-muted-foreground space-y-1">
          <li>Tell us about your business</li>
          <li>Optionally let us read your website to draft your voice</li>
          <li>Pick your subdomain and the channels you'll publish to</li>
        </ul>
      </div>
      <Button size="lg" onClick={onContinue} className="w-full sm:w-auto">
        Get started <ArrowRight className="h-4 w-4 ml-1" />
      </Button>
    </Card>
  )
}

// ── 1. Auth ───────────────────────────────────────────────────────────────────

function AuthScreen({ onSignedIn }) {
  const { isSignedIn } = useUser()
  const [mode, setMode] = useState('signup')

  useEffect(() => {
    if (isSignedIn) onSignedIn()
  }, [isSignedIn, onSignedIn])

  return (
    <Card
      title="Create your account"
      subtitle="One account. Sign back in any time at your workspace's subdomain."
    >
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
  return (
    <div className="space-y-3 text-sm">
      <p>Signed in as <span className="font-mono text-xs">{user?.primaryEmailAddress?.emailAddress}</span>.</p>
      <Button onClick={onContinue}>Continue <ArrowRight className="h-4 w-4 ml-1" /></Button>
    </div>
  )
}

// ── 2. Business basics + scan ────────────────────────────────────────────────

function BusinessScreen({ form, setField, scanState, setScanState, applyScan, onContinue }) {
  const canContinue = form.display_name.trim().length > 0
  const canScan = /^https?:\/\/.+\..+/.test(form.website.trim()) || /^[^\s]+\.[^\s]+/.test(form.website.trim())

  async function runScan() {
    setScanState({ status: 'scanning', error: null, sources: [] })
    try {
      const r = await fetch('/api/onboarding/scan-website', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: form.website }),
      })
      if (!r.ok) {
        const err = await r.json().catch(() => ({}))
        setScanState({ status: 'error', error: err.error || 'scan-failed', sources: [] })
        return
      }
      const data = await r.json()
      applyScan(data)
      setScanState({ status: 'done', error: null, sources: data.source_pages || [] })
    } catch (e) {
      setScanState({ status: 'error', error: 'network-error', sources: [] })
    }
  }

  return (
    <Card
      title="Tell us about your business"
      subtitle="The basics. You can edit any of this later in workspace settings."
    >
      <FieldRow label="Business name *" hint="What you'd put on a sign.">
        <Input value={form.display_name} onChange={e => setField('display_name')(e.target.value)} placeholder="Acme Movement" />
      </FieldRow>
      <FieldRow label="Website" hint="We can scan it to draft your brand voice — optional but recommended.">
        <Input value={form.website} onChange={e => setField('website')(e.target.value)} placeholder="https://yourpractice.com" />
      </FieldRow>
      <FieldRow label="Location" hint="City, state — used in 'near me' SEO copy.">
        <Input value={form.location} onChange={e => setField('location')(e.target.value)} placeholder="Portland, OR" />
      </FieldRow>

      <div className="border rounded-md p-3 bg-muted/30 space-y-2">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-orange-600" />
          <p className="text-sm font-medium">Scan your website to draft your voice</p>
        </div>
        <p className="text-xs text-muted-foreground">
          We'll fetch your home + about page, read the visible copy, and propose
          starter brand voice context. You'll review and edit on the next step.
        </p>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={runScan}
            disabled={!canScan || scanState.status === 'scanning'}
          >
            {scanState.status === 'scanning' && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />}
            {scanState.status === 'done' ? 'Re-scan' : 'Scan my website'}
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
      </div>

      <div className="flex items-center justify-end pt-2">
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

function VoiceScreen({ form, setField, onBack, onContinue }) {
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
        Pick at least one. Founding workspaces get clean exports for every channel — direct publishing integrations are reserved for the first-party Move Better workspaces in beta.
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
      {form.location && <ReviewRow label="Location" value={form.location} />}
      {form.audience_short && <ReviewRow label="Audience" value={form.audience_short} />}
      <ReviewRow label="Channels" value={`${form.enabled_outputs.length} selected`} />
      {submitError && (
        <div className="text-xs text-destructive flex items-center gap-1">
          <AlertCircle className="h-3.5 w-3.5" />
          {submitError === 'slug-taken' && 'That subdomain was just taken. Go back and pick another.'}
          {submitError === 'founding-spots-full' && 'Founding spots filled while you were filling this out. Email us to join the waitlist.'}
          {submitError === 'no-channels-selected' && 'Pick at least one channel.'}
          {submitError === 'org-create-failed' && 'Could not create your workspace org — please try again.'}
          {!['slug-taken','founding-spots-full','no-channels-selected','org-create-failed'].includes(submitError) && submitError}
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

function LaunchingScreen({ redirectUrl }) {
  useEffect(() => {
    if (!redirectUrl) return
    // Brief pause so the user reads the message; Clerk Org propagation is fast
    // but the new subdomain's middleware needs to cache-resolve the slug too.
    const t = setTimeout(() => { window.location.href = redirectUrl }, 1800)
    return () => clearTimeout(t)
  }, [redirectUrl])

  return (
    <Card
      title="Setting up your workspace…"
      subtitle="Provisioning your subdomain, creating your org, and wiring up your voice context. This takes about two seconds."
    >
      <div className="flex items-center gap-3 text-sm text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin text-orange-600" />
        <span>Redirecting to {redirectUrl ? new URL(redirectUrl).host : '…'}</span>
      </div>
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
