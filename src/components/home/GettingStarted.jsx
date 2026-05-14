import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useUser } from '@clerk/clerk-react'
import { Sparkles, CheckCircle2, Circle, X, ChevronRight, Settings } from 'lucide-react'

// Dismissible checklist that helps new users find the four core flows. Auto-
// hides once dismissed (Clerk unsafeMetadata) or all steps are complete.
// Props mirror what Dashboard.jsx passed inline; caller computes the signals.
export default function GettingStarted({
  cliniciansCount = 0,
  completedCount = 0,
  hasMedia = false,
  hasCredential = false,
  isAdmin = false,
}) {
  const { user, isLoaded } = useUser()
  const [dismissed, setDismissed] = useState(false)

  if (!isLoaded) return null

  const alreadyDismissed = Boolean(user?.unsafeMetadata?.gettingStartedDismissedAt)
  if (alreadyDismissed || dismissed) return null

  const items = [
    {
      done: cliniciansCount > 0,
      label: 'Add a clinician',
      detail: 'Create a profile so the AI knows whose voice to write in.',
      to: '/new',
    },
    {
      done: completedCount > 0,
      label: 'Run your first interview',
      detail: '15–30 minutes of conversation produces a full content set.',
      to: '/new',
    },
    {
      done: hasMedia,
      label: 'Add media to the library',
      detail: 'Upload photos and videos to pair with future posts.',
      to: '/library',
    },
    ...(isAdmin
      ? [
          {
            done: hasCredential,
            label: 'Connect a publishing channel',
            detail: 'Wire up the destinations where finished posts will go out.',
            to: '/settings/integrations',
            icon: Settings,
          },
        ]
      : []),
  ]

  const doneCount = items.filter((i) => i.done).length
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
        {items.map((item) => {
          const RowIcon = item.icon
          return (
            <li key={item.label}>
              <Link
                to={item.to}
                className="flex items-start gap-3 rounded-lg p-2.5 -m-2.5 hover:bg-primary/5 transition-colors group"
              >
                {item.done ? (
                  <CheckCircle2 className="h-5 w-5 text-emerald-600 shrink-0 mt-0.5" />
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
                  <p className="text-xs text-muted-foreground mt-0.5">{item.detail}</p>
                </div>
                {RowIcon && !item.done && (
                  <RowIcon className="h-4 w-4 text-muted-foreground shrink-0 mt-1 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity" />
                )}
                <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0 mt-1 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity" />
              </Link>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
