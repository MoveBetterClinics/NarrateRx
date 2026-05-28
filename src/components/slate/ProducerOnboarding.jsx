import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import {
  Clapperboard, ListChecks, ShieldAlert, BarChart3, CheckCircle2,
  ArrowRight, X, Loader2, Sparkles,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { apiFetch } from '@/lib/api'
import { toast } from '@/lib/toast'
import { useWorkspace } from '@/lib/WorkspaceContext'
import { queryKeys } from '@/lib/queries'

// Phase 4 PR 4 — first-run producer onboarding modal.
//
// Shown automatically when:
//   • current_user_tier === 'producer'
//   • current_user_producer_onboarded_at === null
//
// Dismissable from any step (closes + marks onboarded). 4 steps:
//   1. Welcome — who you are in this workspace
//   2. Tabs — what the 4 Slate tabs do
//   3. Approve flow — what happens when you click Approve
//   4. Done — quick reminder where help lives

const STEPS = [
  { key: 'welcome',  title: 'Welcome to Slate' },
  { key: 'tabs',     title: 'Your four tabs' },
  { key: 'approve',  title: 'Approving a package' },
  { key: 'done',     title: "You're set" },
]

export default function ProducerOnboarding({ onComplete }) {
  const ws = useWorkspace()
  const qc = useQueryClient()
  const [step, setStep] = useState(0)
  const [saving, setSaving] = useState(false)

  const workspaceName = ws?.display_name || ws?.name || 'this workspace'
  const current = STEPS[step]
  const isLast = step === STEPS.length - 1

  async function markComplete({ silent = false } = {}) {
    setSaving(true)
    try {
      await apiFetch('/api/clinicians/complete-producer-onboarding', { method: 'POST' })
      // Invalidate workspace so the producer_onboarded_at field refreshes
      qc.invalidateQueries({ queryKey: queryKeys.workspace.me })
      onComplete?.()
    } catch (err) {
      if (!silent) toast.error(err?.message || 'Could not save. You can dismiss and try again.')
      // Still close the modal so the user isn't trapped — they can re-open
      // from the Slate header's "Take the tour" link.
      onComplete?.()
    } finally {
      setSaving(false)
    }
  }

  function handleNext() {
    if (isLast) {
      markComplete()
    } else {
      setStep((s) => s + 1)
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="producer-onboarding-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
    >
      <div className="bg-card rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border bg-muted/40">
          <div className="flex items-center gap-3 min-w-0">
            <Sparkles className="h-5 w-5 text-primary shrink-0" />
            <h2 id="producer-onboarding-title" className="text-base font-bold truncate">
              {current.title}
            </h2>
          </div>
          <button
            type="button"
            onClick={() => markComplete({ silent: true })}
            className="text-muted-foreground hover:text-foreground rounded p-1"
            aria-label="Skip onboarding"
            disabled={saving}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Step body */}
        <div className="px-6 py-6 overflow-y-auto flex-1 text-sm">
          {step === 0 && <WelcomeStep workspaceName={workspaceName} />}
          {step === 1 && <TabsStep />}
          {step === 2 && <ApproveStep />}
          {step === 3 && <DoneStep />}
        </div>

        {/* Footer with step dots + nav */}
        <div className="flex items-center justify-between px-5 py-4 border-t border-border bg-muted/30">
          <div className="flex items-center gap-1.5">
            {STEPS.map((s, i) => (
              <span
                key={s.key}
                className={`h-1.5 rounded-full transition-all ${
                  i === step ? 'w-6 bg-primary' :
                  i <  step ? 'w-1.5 bg-primary/40' :
                              'w-1.5 bg-muted-foreground/20'
                }`}
                aria-current={i === step ? 'step' : undefined}
              />
            ))}
            <span className="text-3xs text-muted-foreground ml-2">
              {step + 1} of {STEPS.length}
            </span>
          </div>
          <div className="flex items-center gap-2">
            {step > 0 && !isLast && (
              <Button
                size="sm" variant="ghost"
                onClick={() => setStep((s) => s - 1)}
                disabled={saving}
              >
                Back
              </Button>
            )}
            <Button size="sm" onClick={handleNext} disabled={saving}>
              {saving ? (
                <><Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> Saving…</>
              ) : isLast ? (
                <><CheckCircle2 className="h-3.5 w-3.5 mr-1.5" /> Start using Slate</>
              ) : (
                <>Next <ArrowRight className="h-3.5 w-3.5 ml-1.5" /></>
              )}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Steps ───────────────────────────────────────────────────────────────────

function WelcomeStep({ workspaceName }) {
  return (
    <div className="flex flex-col gap-3">
      <p>
        {`You're set up as the `}<strong>Producer</strong>{` for `}
        <strong>{workspaceName}</strong>{`. Slate is where you'll spend most of your time.`}
      </p>
      <p>
        Every morning the AI brain proposes a few story packages based on the
        team&rsquo;s latest media + topic gaps. Your job is to review them,
        approve the good ones, and skip the rest.
      </p>
      <div className="rounded-lg bg-amber-50 border border-amber-200 text-amber-900 px-3 py-2.5 text-xs leading-relaxed mt-1">
        <strong>{`Note:`}</strong>{` you won't see Home, Stories, Library, or
        Settings in the nav — those are for clinicians and admins. If you need
        something locked, ask the workspace owner.`}
      </div>
    </div>
  )
}

function TabsStep() {
  return (
    <div className="flex flex-col gap-3">
      <p>{`Slate has four tabs. Each one shows packages in a different state:`}</p>
      <ul className="space-y-2.5">
        <TabRow
          Icon={Clapperboard}
          name="Today"
          desc="Fresh packages waiting for review. This is your default landing."
        />
        <TabRow
          Icon={ListChecks}
          name="Triage"
          desc="Packages that need attention — render failed, low confidence, or stale (>36h old, undecided)."
          accent="amber"
        />
        <TabRow
          Icon={ShieldAlert}
          name="Consent"
          desc="Packages whose source media is pending or revoked consent. Block approve until resolved."
          accent="sky"
        />
        <TabRow
          Icon={BarChart3}
          name="Coverage"
          desc="Read-only dashboard: who needs to capture more, which topics still need source material."
          accent="emerald"
        />
      </ul>
    </div>
  )
}

function TabRow({ Icon, name, desc, accent }) {
  const colorMap = {
    primary: 'text-primary',
    amber:   'text-amber-600',
    sky:     'text-sky-600',
    emerald: 'text-emerald-600',
  }
  return (
    <li className="flex items-start gap-3">
      <Icon className={`h-4 w-4 mt-0.5 shrink-0 ${colorMap[accent] || colorMap.primary}`} />
      <div>
        <span className="font-semibold">{name}</span>
        <span className="text-muted-foreground"> — {desc}</span>
      </div>
    </li>
  )
}

function ApproveStep() {
  return (
    <div className="flex flex-col gap-3">
      <p>{`When you click `}<strong>Approve</strong>{` on a package:`}</p>
      <ol className="space-y-2 list-decimal list-inside marker:text-muted-foreground marker:font-semibold">
        <li>
          {`The package's renders are staged in `}<strong>Drafts</strong>{` — one
          row per platform (LinkedIn, Instagram, blog, etc.).`}
        </li>
        <li>
          {`The workspace admin can then push to Buffer or your other publishing
          channels — that part is owned by them, not you.`}
        </li>
        <li>{`The package leaves the slate and won't reappear tomorrow.`}</li>
      </ol>
      <p>
        {`If a package isn't right — wrong clip, off-tone caption — use `}
        <strong>Edit</strong>{` to tweak the caption or re-render. `}
        <strong>Skip</strong>{` dismisses without staging anything.`}
      </p>
    </div>
  )
}

function DoneStep() {
  return (
    <div className="flex flex-col gap-3">
      <p>{`You're all set. A few things to know:`}</p>
      <ul className="space-y-2 text-muted-foreground">
        <li>
          {`• Today's slate auto-generates 3–4 packages when you click `}
          <strong>{"Generate today's slate"}</strong>{`.`}
        </li>
        <li>
          {`• You can re-open this tour any time from the `}
          <strong>{"Take the tour"}</strong>{` link in the Slate header.`}
        </li>
        <li>
          {`• Questions? Ping the workspace owner directly — they can
          adjust your access if you need more or less.`}
        </li>
      </ul>
    </div>
  )
}
