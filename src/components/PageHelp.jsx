import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { HelpCircle, X, BookOpen } from 'lucide-react'
import { Button } from '@/components/ui/button'
import Icon from '@/components/ui/Icon'
import { HELP_CONTENT } from '@/lib/helpContent'

// Generic per-page Help affordance. Content comes from helpContent.jsx keyed
// by `pageKey`. Two ways to surface, matching the original MediaHubHelp:
//   1. First-visit auto-open — fires once per browser session (sessionStorage),
//      so a new user navigating Home → Slate → Stories doesn't get three
//      stacked modals. Subsequent page visits in the same session skip auto-open.
//   2. A "?" chip next to the page title (always available for on-demand access)
//
// variant:
//   'default'    — primary-tinted chip, for light page headers (e.g. Stories)
//   'onGradient' — white translucent chip, for the nx-grad-ribbon gradient
//                  header used on Home and Slate
const SESSION_WELCOMED_KEY = 'pagehelp:session:welcomed'

export default function PageHelp({ pageKey, variant = 'default' }) {
  const [open, setOpen] = useState(false)
  const content = HELP_CONTENT[pageKey]
  const pageSeenKey = `pagehelp:${pageKey}:welcomed:v1`

  // First-visit auto-open — session-scoped so only the first page in a new
  // session auto-opens. The chip remains available on every page for on-demand access.
  useEffect(() => {
    if (!content) return
    try {
      const sessionWelcomed = sessionStorage.getItem(SESSION_WELCOMED_KEY)
      const pageSeen = localStorage.getItem(pageSeenKey)
      if (!sessionWelcomed && !pageSeen) {
        setOpen(true)
        sessionStorage.setItem(SESSION_WELCOMED_KEY, '1')
        localStorage.setItem(pageSeenKey, new Date().toISOString())
      }
    } catch { /* empty */ }
  }, [content, pageSeenKey])

  if (!content) return null

  const chipCls = variant === 'onGradient'
    ? 'inline-flex items-center gap-1.5 px-2.5 h-7 rounded-full bg-white/15 text-white text-xs font-medium hover:bg-white/25 transition-colors'
    : 'inline-flex items-center gap-1.5 px-2.5 h-7 rounded-full border border-primary/30 bg-primary/10 text-primary text-xs font-medium hover:bg-primary/20 transition-colors'

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className={chipCls}
        title={`How ${content.title.split(' — ')[0]} works`}
        aria-label="Help"
      >
        <Icon as={HelpCircle} size="sm" />
        <span>How it works</span>
      </button>

      {open && createPortal(
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
          <div className="bg-background rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between px-5 py-3 border-b shrink-0">
              <h2 className="font-semibold text-sm">{content.title}</h2>
              <Button variant="ghost" size="icon" onClick={() => setOpen(false)}><Icon as={X} size="md" /></Button>
            </div>

            <div className="flex-1 overflow-y-auto p-5 space-y-5 text-sm">
              {/* Recall hint — surfaced first so it's seen before users scroll. */}
              <div className="rounded-md border-2 border-primary/40 bg-primary/5 p-3 flex items-start gap-2.5">
                <BookOpen className="h-5 w-5 text-primary shrink-0 mt-0.5" />
                <div className="text-xs">
                  <p className="font-semibold text-foreground">You can come back to this guide anytime.</p>
                  <p className="text-muted-foreground mt-0.5">
                    Look for the <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full border border-primary/30 bg-primary/10 text-primary font-medium"><Icon as={HelpCircle} size="xs" />Help / How this works</span> button at the top of this page. Click it any time you need a refresher.
                  </p>
                </div>
              </div>

              <p className="text-muted-foreground">{content.intro}</p>

              <ol className="space-y-3">
                {content.steps.map((step, i) => (
                  <Step key={i} icon={<Icon as={step.icon} size="md" />} num={i + 1} title={step.title}>
                    {step.body}
                  </Step>
                ))}
              </ol>

              {(content.notes || []).map((note, i) => (
                <div key={i} className="rounded-md border bg-muted/40 p-3 text-xs space-y-2">
                  <div className="font-medium">{note.title}</div>
                  <p className="text-muted-foreground">{note.body}</p>
                </div>
              ))}
            </div>

            <div className="flex items-center justify-end px-5 py-3 border-t shrink-0">
              <Button size="sm" onClick={() => setOpen(false)}>Got it</Button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  )
}

function Step({ icon, num, title, children }) {
  return (
    <li className="flex gap-3">
      <div className="shrink-0 h-7 w-7 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-semibold">
        {num}
      </div>
      <div className="min-w-0">
        <div className="flex items-center gap-1.5 font-medium text-foreground">
          <span className="text-primary shrink-0">{icon}</span>
          <span>{title}</span>
        </div>
        <p className="text-muted-foreground mt-0.5">{children}</p>
      </div>
    </li>
  )
}
