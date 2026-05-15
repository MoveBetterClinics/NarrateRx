import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useUser } from '@clerk/clerk-react'
import { Sparkles, CheckCircle2, Circle, X, ChevronRight } from 'lucide-react'
import { useOnboardingProgress } from '@/lib/queries'

const STEPS = [
  {
    key: 'complete_profile',
    label: 'Complete your profile',
    description: 'Add your practice name and specialty',
    href: '/settings/workspace',
  },
  {
    key: 'run_first_interview',
    label: 'Run your first interview',
    description: 'Capture a clinician story',
    href: '/new',
  },
  {
    key: 'generate_post',
    label: 'Generate a social post',
    description: 'Turn the interview into content',
    href: '/stories',
  },
  {
    key: 'publish',
    label: 'Publish to social media',
    description: 'Push your first post to Buffer',
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
    <div className="rounded-xl border bg-gradient-to-br from-primary/5 to-background p-5">
      <div className="flex items-start justify-between gap-3 mb-4">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-primary" />
          <p className="text-sm font-semibold">Getting started</p>
          <span className="text-xs text-muted-foreground">
            {doneCount} of {items.length} done
          </span>
        </div>
        <button
          type="button"
          onClick={handleDismiss}
          aria-label="Dismiss getting started checklist"
          className="text-muted-foreground hover:text-foreground rounded p-1 -m-1"
        >
          <X className="h-4 w-4" />
        </button>
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
