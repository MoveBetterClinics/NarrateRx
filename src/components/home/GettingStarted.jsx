import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useUser } from '@clerk/react'
import { Sparkles, CheckCircle2, Circle, X, ChevronRight } from 'lucide-react'
import Icon from '@/components/ui/Icon'
import { useOnboardingProgress } from '@/lib/queries'

const STEPS = [
  {
    key: 'onboarding_interview',
    label: 'Set up your voice (about 5 minutes)',
    description: 'Answer a few questions out loud so NarrateRx learns how you talk — then everything it writes sounds like you.',
    href: '/onboard/interview',
  },
  {
    key: 'run_first_interview',
    label: 'Record your first interview',
    description: 'Talk for about 15 minutes about your work. This one conversation is what becomes a month of content.',
    href: '/new',
  },
  {
    key: 'approve_draft',
    label: 'Review your first draft',
    description: 'See what NarrateRx wrote from your own words — tweak anything you want, then approve it.',
    href: '/?bucket=review',
  },
  {
    key: 'publish',
    label: 'Publish your first post',
    description: 'Send it live to your blog, social, or Google. That\'s the whole loop — done.',
    href: '/stories',
  },
]

// Dismissible activation checklist. Auto-hides when all steps are done
// (onboarding_completed_at set server-side) or when user dismisses via
// Clerk unsafeMetadata. Progress is fetched from /api/onboarding/progress
// and auto-verified against live DB counts — no manual marking required.
export default function GettingStarted() {
  const { user, isLoaded } = useUser()
  const [dismissed, setDismissed] = useState(false)

  const { data: progress } = useOnboardingProgress({
    enabled: isLoaded && !dismissed && !user?.unsafeMetadata?.gettingStartedDismissedAt,
  })

  if (!isLoaded) return null

  const alreadyDismissed = Boolean(user?.unsafeMetadata?.gettingStartedDismissedAt)
  if (alreadyDismissed || dismissed) return null

  // Hide once fully completed
  if (progress?.completed) return null

  // Build step list by merging API response with static config. Fall back to
  // all undone while the initial fetch is in flight.
  const doneMap = {}
  if (progress?.steps) {
    for (const s of progress.steps) {
      doneMap[s.key] = s.done
    }
  }
  const items = STEPS.map((s) => ({ ...s, done: Boolean(doneMap[s.key]) }))
  const doneCount = items.filter((i) => i.done).length

  // If all steps are done locally but completed flag hasn't propagated yet,
  // still hide to avoid a flash.
  if (doneCount === items.length) return null

  async function handleDismiss() {
    setDismissed(true)
    try {
      await user?.update({
        unsafeMetadata: {
          ...(user.unsafeMetadata || {}),
          gettingStartedDismissedAt: new Date().toISOString(),
        },
      })
    } catch {
      // Locally hidden either way; metadata write is best-effort.
    }
  }

  return (
    <div className="rounded-2xl border border-[#f3d3b5] bg-gradient-to-b from-white to-[#fefaf7] p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04),0_8px_24px_-18px_rgba(227,101,37,0.22)]">
      <div className="flex items-start justify-between gap-3 mb-1">
        <div className="flex items-center gap-2">
          <span
            className="inline-block w-1 h-5 rounded-full shrink-0"
            style={{ background: 'hsl(var(--primary))' }}
            aria-hidden="true"
          />
          <Icon as={Sparkles} size="md" className="text-primary" />
          <h2 className="text-xl font-bold tracking-tight">Getting started</h2>
        </div>
        <button
          type="button"
          onClick={handleDismiss}
          aria-label="Dismiss getting started checklist"
          className="text-muted-foreground hover:text-foreground rounded p-1 -m-1"
        >
          <Icon as={X} size="md" />
        </button>
      </div>

      <p className="text-sm text-muted-foreground ml-3 mb-4">
        {doneCount === 0
          ? 'Four quick steps to your first post — written in your own voice.'
          : doneCount === items.length - 1
            ? 'One step left — publish and you\'ve done the whole loop.'
            : 'Nice progress. Keep going to your first published post.'}
      </p>

      {/* Progress bar — the visual "how far am I" signal. */}
      <div className="ml-3 mb-5" aria-hidden="true">
        <div className="flex items-center gap-3">
          <div className="flex-1 h-2 rounded-full bg-primary/10 overflow-hidden">
            <div
              className="h-full rounded-full bg-primary transition-[width] duration-500 ease-out"
              style={{ width: `${(doneCount / items.length) * 100}%` }}
            />
          </div>
          <span className="text-xs font-semibold text-primary tabular-nums shrink-0">
            {doneCount} / {items.length}
          </span>
        </div>
      </div>

      <ul className="space-y-2">
        {items.map((item) => (
          <li key={item.key}>
            <Link
              to={item.href}
              className="flex items-start gap-3 rounded-lg p-2.5 -m-2.5 hover:bg-primary/5 transition-colors group"
            >
              {item.done ? (
                <CheckCircle2 className="h-5 w-5 text-primary shrink-0 mt-0.5" />
              ) : (
                <Circle className="h-5 w-5 text-muted-foreground/40 shrink-0 mt-0.5" />
              )}
              <div className="flex-1 min-w-0">
                <p
                  className={`text-sm font-medium ${
                    item.done ? 'text-muted-foreground line-through' : ''
                  }`}
                >
                  {item.label}
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">{item.description}</p>
              </div>
              <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0 mt-1 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity" />
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}
