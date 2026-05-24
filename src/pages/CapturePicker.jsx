import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { ArrowLeft, Mic, MessageSquareText, Phone, Presentation, Link as LinkIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { useDocumentTitle } from '@/lib/useDocumentTitle'
import { useWorkspace } from '@/lib/WorkspaceContext'

/**
 * CapturePicker — entry point at /new. Asks the user which capture mode they
 * want before sending them down the dedicated flow.
 *
 *   /new              → this picker
 *   /new/interview    → existing NewInterview form (AI-led chat)
 *   /new/voice-memo   → quick voice recording (new in Phase 1)
 *   /new/seminar      → long-talk upload (Phase 2, disabled today)
 *
 * Query params (e.g. ?topic=, ?topicBacklogId=) are forwarded to whichever
 * mode the user picks so deep links from suggestions / backlog still work.
 */
export default function CapturePicker() {
  useDocumentTitle('New capture')
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const workspace = useWorkspace()
  // Live Interview lane (formerly "Phone Call") is gated on the per-workspace
  // realtime_voice_enabled flag. Default false — only workspaces explicitly
  // onboarded to the Phase 5 spike see the tile. Avoids the $5/call surprise
  // for tenants who haven't asked.
  const liveInterviewEnabled = workspace?.realtime_voice_enabled === true

  // Preserve any incoming query params (?topic=…, ?topicBacklogId=…) when
  // routing into the chosen mode — these come from suggestion links and
  // topic-backlog cards.
  const qs = searchParams.toString()
  const suffix = qs ? `?${qs}` : ''

  function go(path) {
    navigate(`${path}${suffix}`)
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" asChild>
          <Link to="/">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">New capture</h1>
          <p className="text-sm text-muted-foreground">
            How would you like to capture this one?
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {/* Interview — existing AI-led flow */}
        <button
          type="button"
          onClick={() => go('/new/interview')}
          className="text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded-lg"
        >
          <Card className="h-full transition hover:border-primary hover:shadow-sm">
            <CardContent className="p-5 space-y-3">
              <div className="h-10 w-10 rounded-md bg-primary/10 text-primary flex items-center justify-center">
                <MessageSquareText className="h-5 w-5" />
              </div>
              <div>
                <div className="font-medium">Start Interview</div>
                <p className="text-sm text-muted-foreground mt-1">
                  AI-led conversation. Best when you want to think out loud
                  about a topic and let prompts surface your thinking.
                </p>
              </div>
            </CardContent>
          </Card>
        </button>

        {/* Voice Memo — new in Phase 1 */}
        <button
          type="button"
          onClick={() => go('/new/voice-memo')}
          className="text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded-lg"
        >
          <Card className="h-full transition hover:border-primary hover:shadow-sm">
            <CardContent className="p-5 space-y-3">
              <div className="h-10 w-10 rounded-md bg-primary/10 text-primary flex items-center justify-center">
                <Mic className="h-5 w-5" />
              </div>
              <div>
                <div className="font-medium">Voice Memo</div>
                <p className="text-sm text-muted-foreground mt-1">
                  Quick capture. Hit record, say what happened, save. For real
                  moments between patients or end-of-day reflections.
                </p>
              </div>
            </CardContent>
          </Card>
        </button>

        {/* Live Interview — real-time duplex voice (Phase 5 spike, Beta).
            Gated on workspace.realtime_voice_enabled; hidden entirely for
            workspaces that haven't been onboarded yet. Originally shipped
            as "Phone Call" — renamed 2026-05-24 because "live interview"
            better matches what users called it and avoids confusion with
            actual telephony. */}
        {liveInterviewEnabled && (
        <button
          type="button"
          onClick={() => go('/new/live-interview')}
          className="text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded-lg"
        >
          <Card className="h-full transition hover:border-primary hover:shadow-sm">
            <CardContent className="p-5 space-y-3">
              <div className="flex items-start justify-between">
                <div className="h-10 w-10 rounded-md bg-primary/10 text-primary flex items-center justify-center">
                  <Phone className="h-5 w-5" />
                </div>
                <span className="text-3xs font-medium uppercase tracking-wide px-1.5 py-0.5 rounded border text-muted-foreground">
                  Beta
                </span>
              </div>
              <div>
                <div className="font-medium">Live Interview</div>
                <p className="text-sm text-muted-foreground mt-1">
                  Continuous voice conversation with Bernard. No press-to-talk —
                  just talk, pause, think out loud.
                </p>
              </div>
            </CardContent>
          </Card>
        </button>
        )}

        {/* Import writing — URL import lane */}
        <button
          type="button"
          onClick={() => go('/new/import')}
          className="text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded-lg"
        >
          <Card className="h-full transition hover:border-primary hover:shadow-sm">
            <CardContent className="p-5 space-y-3">
              <div className="h-10 w-10 rounded-md bg-primary/10 text-primary flex items-center justify-center">
                <LinkIcon className="h-5 w-5" />
              </div>
              <div>
                <div className="font-medium">Import writing</div>
                <p className="text-sm text-muted-foreground mt-1">
                  Paste a URL from your blog or any article you&apos;ve written.
                  We pull the text and turn it into fresh content.
                </p>
              </div>
            </CardContent>
          </Card>
        </button>
      </div>

      {/* Seminar / Talk — Phase 2 placeholder. Visible-but-disabled so users
          know it's coming; prevents the picker from looking incomplete. */}
      <div>
        <div
          className="rounded-lg border border-dashed bg-muted/30 p-4 flex items-start gap-3 opacity-70"
          aria-disabled="true"
        >
          <div className="h-10 w-10 rounded-md bg-muted text-muted-foreground flex items-center justify-center shrink-0">
            <Presentation className="h-5 w-5" />
          </div>
          <div className="flex-1">
            <div className="font-medium text-foreground">Seminar / Talk <span className="ml-2 text-xs font-normal text-muted-foreground">— coming soon</span></div>
            <p className="text-sm text-muted-foreground mt-1">
              Upload a long recording (45+ min) from a seminar or public talk.
              Pipeline extracts chapters, audience Q&A, and ready-to-publish
              pieces. Available shortly after the June 25 capture.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
