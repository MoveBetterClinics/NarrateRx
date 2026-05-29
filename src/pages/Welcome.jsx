import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useUser } from '@clerk/react'
import { ChevronLeft, ChevronRight, Loader2, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { workspace } from '@/lib/workspace'
import { useWorkspaceState } from '@/lib/WorkspaceContext'
import { getPendingAnnouncement, markAnnouncementSeen } from '@/lib/announcements'

// Renders the next pending announcement for the signed-in user. The
// WelcomeGate routes here automatically when there's something unseen.
export default function Welcome() {
  const { user, isLoaded } = useUser()
  const { workspace: ws } = useWorkspaceState()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [step, setStep] = useState(0)
  const [finishing, setFinishing] = useState(false)
  const resetting = searchParams.get('reset') === '1'

  // QA escape hatch: /welcome?reset=1 clears all per-user "seen" flags so the
  // welcome flow + dashboard checklist replay from scratch. Strips the query
  // param and reloads once done.
  useEffect(() => {
    if (!resetting || !isLoaded || !user) return
    ;(async () => {
      try {
        await user.update({
          unsafeMetadata: {
            ...(user.unsafeMetadata || {}),
            seenAnnouncements: [],
            gettingStartedDismissedAt: null,
          },
        })
      } finally {
        window.location.replace('/welcome')
      }
    })()
  }, [resetting, isLoaded, user])

  if (!isLoaded || resetting) return null

  const announcement = getPendingAnnouncement(user)

  // Defensive: WelcomeGate already checks this, but if someone hits /welcome
  // directly with nothing pending, send them home.
  if (!announcement) {
    navigate('/', { replace: true })
    return null
  }

  const appName = ws?.app_name ?? workspace.appName
  const eyebrow =
    announcement.eyebrow ||
    (announcement.kind === 'welcome' ? `Welcome to ${appName}` : "What's new")
  const steps = announcement.steps
  const isLast = step === steps.length - 1
  const current = steps[step]
  const Icon = current.icon

  async function handleFinish() {
    setFinishing(true)
    try {
      await markAnnouncementSeen(user, announcement.key)
    } catch {
      // Best-effort — don't block the user on a metadata write.
    }
    navigate('/', { replace: true })
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="w-full max-w-xl">
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground uppercase tracking-wider">
            <Sparkles className="h-3.5 w-3.5" />
            {eyebrow}
          </div>
        </div>

        <div className="rounded-2xl border bg-card shadow-sm p-8 sm:p-10">
          <div className={`h-12 w-12 rounded-xl flex items-center justify-center mb-5 ${current.accent}`}>
            <Icon className="h-6 w-6" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight mb-3">{current.title}</h1>
          <p className="text-sm text-muted-foreground leading-relaxed">{current.body}</p>

          {steps.length > 1 && (
            <div className="flex items-center justify-center gap-1.5 mt-8 mb-6">
              {steps.map((_, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => setStep(i)}
                  aria-label={`Go to step ${i + 1}`}
                  className={`h-1.5 rounded-full transition-all ${
                    i === step ? 'w-6 bg-primary' : 'w-1.5 bg-muted hover:bg-muted-foreground/30'
                  }`}
                />
              ))}
            </div>
          )}

          <div className={`flex items-center justify-between gap-3 ${steps.length > 1 ? '' : 'mt-8'}`}>
            {steps.length > 1 ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setStep((s) => Math.max(0, s - 1))}
                disabled={step === 0 || finishing}
              >
                <ChevronLeft className="h-4 w-4 mr-1" />
                Back
              </Button>
            ) : (
              <div />
            )}

            {steps.length > 1 ? (
              <p className="text-xs text-muted-foreground tabular-nums">
                {step + 1} of {steps.length}
              </p>
            ) : (
              <div />
            )}

            {isLast ? (
              <Button size="sm" onClick={handleFinish} disabled={finishing}>
                {finishing ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : announcement.kind === 'welcome' ? (
                  'Get started'
                ) : (
                  'Got it'
                )}
              </Button>
            ) : (
              <Button size="sm" onClick={() => setStep((s) => s + 1)}>
                Next
                <ChevronRight className="h-4 w-4 ml-1" />
              </Button>
            )}
          </div>
        </div>

        <div className="text-center mt-5">
          <button
            type="button"
            onClick={handleFinish}
            disabled={finishing}
            className="text-xs text-muted-foreground hover:text-foreground hover:underline disabled:opacity-50"
          >
            {announcement.kind === 'welcome' ? 'Skip intro' : 'Dismiss'}
          </button>
        </div>
      </div>
    </div>
  )
}
