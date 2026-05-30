// "Finish onboarding" card on Home. Surfaces the one-time founder interview
// while it's not done. Three visible states:
//   - Not started        — no row yet, or row has 0 messages
//   - In progress        — row exists with messages, status='in_progress'
//   - Synthesizing       — row exists, status='completed' but workspace
//                          onboarding_interview_completed_at is still null
//                          (the brief window between completion and synthesis
//                          landing on the workspaces row).
//
// Visibility gates (in order):
//   1. User must be admin
//   2. workspace.onboarding_interview_completed_at must be NULL
//   3. Card must not be snoozed (24h via localStorage)
//
// Once synthesis lands its workspace PATCH (setting
// onboarding_interview_completed_at = now), this card disappears for good.

import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Sparkles, ArrowRight, Loader2, BellOff } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { useWorkspace } from '@/lib/WorkspaceContext'
import { useUserRole } from '@/lib/useUserRole'
import { apiFetch } from '@/lib/api'

const SNOOZE_HOURS = 24
const SNOOZE_MS = SNOOZE_HOURS * 60 * 60 * 1000

function snoozeKey(workspaceId) {
  return `narraterx.onboarding-snooze.${workspaceId}`
}

function isSnoozed(workspaceId) {
  if (typeof window === 'undefined' || !workspaceId) return false
  try {
    const raw = window.localStorage.getItem(snoozeKey(workspaceId))
    if (!raw) return false
    const ts = parseInt(raw, 10)
    if (!Number.isFinite(ts)) return false
    return Date.now() - ts < SNOOZE_MS
  } catch {
    return false
  }
}

function setSnooze(workspaceId) {
  if (typeof window === 'undefined' || !workspaceId) return
  try {
    window.localStorage.setItem(snoozeKey(workspaceId), String(Date.now()))
  } catch {
    /* localStorage disabled — non-fatal; user just sees the card next render */
  }
}

export default function OnboardingCard() {
  const workspace = useWorkspace()
  const { role } = useUserRole()
  const [interview, setInterview] = useState(null)
  const [loaded, setLoaded] = useState(false)
  const [snoozed, setSnoozed] = useState(false)

  // Preserve testing flags like ?dryRun=1 across the Start/Continue link so
  // the user doesn't lose the flag they typed into the URL bar on Home. v1
  // forwards the whole querystring; cheaper than a per-key allowlist and the
  // interview page only honors known params.
  const [searchParams] = useSearchParams()
  const interviewHref = (() => {
    const qs = searchParams.toString()
    return qs ? `/onboard/interview?${qs}` : '/onboard/interview'
  })()

  // Visibility precheck — bail before any fetch if the card couldn't render
  // anyway. Saves a network round trip on the 99% case (workspace fully
  // onboarded, or viewer isn't admin).
  const shouldRender =
    !!workspace?.id &&
    role === 'admin' &&
    !workspace.onboarding_interview_completed_at

  useEffect(() => {
    if (!shouldRender) return
    setSnoozed(isSnoozed(workspace.id))
  }, [shouldRender, workspace?.id])

  useEffect(() => {
    if (!shouldRender || snoozed) return
    let cancelled = false
    ;(async () => {
      try {
        const row = await apiFetch('/api/onboarding/interview')
        if (!cancelled) setInterview(row)
      } catch {
        // Non-fatal — card just won't render. Don't surface a Home-page error
        // for a side-widget fetch.
      } finally {
        if (!cancelled) setLoaded(true)
      }
    })()
    return () => { cancelled = true }
  }, [shouldRender, snoozed])

  if (!shouldRender) return null
  if (snoozed) return null
  if (!loaded) return null  // Avoid a flash of the "not started" copy
                            // before we know whether a row exists.

  const messages = Array.isArray(interview?.messages) ? interview.messages : []
  const turnsIn = messages.filter((m) => m?.role === 'user').length
  const status = interview?.status ?? null

  // Hidden case: interview is fully done. (Workspace flag check above should
  // already hide us; this is belt + suspenders for the synthesized-but-flag-
  // not-yet-set race window — UX prefers "gone" over "click me again".)
  if (status === 'synthesized') return null

  const isSynthesizing = status === 'completed'
  const isContinuing   = status === 'in_progress' && turnsIn > 0
  // `isStarting` is the implicit else branch — no row yet, or zero answers in.

  return (
    <Card className="border-primary/30 bg-primary/5">
      <CardContent className="pt-5 pb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:gap-4">
        {/* Icon + text group — fills full width on mobile so text can wrap */}
        <div className="flex items-start gap-4 flex-1 min-w-0">
          <div className="h-10 w-10 rounded-full bg-primary/15 flex items-center justify-center shrink-0">
            <Sparkles className="h-5 w-5 text-primary" />
          </div>

          <div className="flex-1 min-w-0 space-y-1">
            {isSynthesizing ? (
              <>
                <p className="font-semibold text-sm">Synthesizing your workspace voice…</p>
                <p className="text-sm text-muted-foreground">
                  We&apos;re reading your transcript and writing your voice guidance, patient archetype, topic queue, and phrase bank. About a minute.
                </p>
              </>
            ) : isContinuing ? (
              <>
                <p className="font-semibold text-sm">
                  Continue your onboarding interview — {turnsIn} answer{turnsIn === 1 ? '' : 's'} in
                </p>
                <p className="text-sm text-muted-foreground">
                  Pick up where you left off. Once finished, NarrateRx will use your voice instead of the paradigm defaults.
                </p>
              </>
            ) : (
              <>
                <p className="font-semibold text-sm">
                  Tell NarrateRx about {workspace?.display_name || 'your practice'}
                </p>
                <p className="text-sm text-muted-foreground">
                  ~15 minutes. We&apos;ll learn your voice, patient type, and the topics you wish more people understood — then every piece NarrateRx generates will sound like you, not a template.
                </p>
              </>
            )}
          </div>
        </div>

        {/* Buttons — below text on mobile (indented to align under text), inline on sm+ */}
        <div className="flex items-center gap-2 shrink-0 pl-14 sm:pl-0 sm:self-center">
          {isSynthesizing ? (
            <Button asChild variant="outline" size="sm">
              <Link to={interviewHref}>
                <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                Watch progress
              </Link>
            </Button>
          ) : (
            <>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setSnooze(workspace.id)
                  setSnoozed(true)
                }}
                title={`Snooze for ${SNOOZE_HOURS} hours`}
              >
                <BellOff className="h-3.5 w-3.5 mr-1.5" />
                Remind me later
              </Button>
              <Button asChild size="sm">
                <Link to={interviewHref}>
                  {isContinuing ? 'Continue' : 'Start'}
                  <ArrowRight className="h-3.5 w-3.5 ml-1.5" />
                </Link>
              </Button>
            </>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
