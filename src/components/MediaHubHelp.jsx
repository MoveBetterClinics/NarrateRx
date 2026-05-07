import { useEffect, useState } from 'react'
import { HelpCircle, X, Camera, Sparkles, Pencil, Upload, Send, BookOpen } from 'lucide-react'
import { Button } from '@/components/ui/button'

const WELCOME_KEY = 'mediahub:welcomed:v1'

// MediaHub help affordance. Two ways to surface:
//   1. First-visit auto-open (page-scoped via localStorage flag)
//   2. "?" icon next to the page title
//
// Open to everyone — clinicians, admin staff, Phillip — anyone who lands on
// the Media page. Content adapts to who they are by emphasising the
// shared workflow rather than role-gating sections.
export default function MediaHubHelp() {
  const [open, setOpen] = useState(false)

  // First-visit auto-open.
  useEffect(() => {
    try {
      const seen = localStorage.getItem(WELCOME_KEY)
      if (!seen) {
        setOpen(true)
        localStorage.setItem(WELCOME_KEY, new Date().toISOString())
      }
    } catch {}
  }, [])

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 px-2.5 h-7 rounded-full border border-primary/30 bg-primary/10 text-primary text-xs font-medium hover:bg-primary/20 transition-colors"
        title="How the Media Hub works"
        aria-label="Help"
      >
        <HelpCircle className="h-3.5 w-3.5" />
        <span>Help / How this works</span>
      </button>

      {open && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
          <div className="bg-background rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between px-5 py-3 border-b shrink-0">
              <h2 className="font-semibold text-sm">Media Hub — how it works</h2>
              <Button variant="ghost" size="icon" onClick={() => setOpen(false)}><X className="h-4 w-4" /></Button>
            </div>

            <div className="flex-1 overflow-y-auto p-5 space-y-5 text-sm">
              {/* Recall hint — surfaced first so it's seen before users scroll. */}
              <div className="rounded-md border-2 border-primary/40 bg-primary/5 p-3 flex items-start gap-2.5">
                <BookOpen className="h-5 w-5 text-primary shrink-0 mt-0.5" />
                <div className="text-xs">
                  <p className="font-semibold text-foreground">You can come back to this guide anytime.</p>
                  <p className="text-muted-foreground mt-0.5">
                    Look for the <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full border border-primary/30 bg-primary/10 text-primary font-medium"><HelpCircle className="h-3 w-3" />Help / How this works</span> button at the top of the Media Hub page, just below the title. Click it any time you need a refresher.
                  </p>
                </div>
              </div>

              <p className="text-muted-foreground">
                The Media Hub is where raw clinic capture and finished edits live together. The system suggests what each clip could become; an editor (typically Phillip) takes accepted suggestions to CapCut, brings finished files back, then attaches them to posts in Content Hub.
              </p>

              <ol className="space-y-3">
                <Step icon={<Camera className="h-4 w-4" />} num={1} title="Capture (Phillip, in clinic)">
                  Film treatment moments, demonstrations, and clinician explanations. Aim for 30–90s segments where something specific is being taught or shown. Patient consent (verbal at minimum, written when published as a piece featuring them) is required for anything that goes public.
                </Step>
                <Step icon={<Upload className="h-4 w-4" />} num={2} title="Upload">
                  Drop files into the uploader at the top of this page. Pick "Who's speaking?" — Clinician (default for in-clinic capture), Admin staff (operations/business interviews), or Patient guest (consent required). Within ~60s the system will tag what's shown and transcribe what's said.
                </Step>
                <Step icon={<Sparkles className="h-4 w-4" />} num={3} title="Review AI-suggested briefs">
                  After tagging completes, the system surfaces 1–5 "edit briefs" per clip — moments worth turning into a finished, reusable post. Each brief includes a draft caption, a suggested platform, and a verbatim source quote. Open the Edit Briefs section below to review. Accept the strong ones, reject the rest.
                </Step>
                <Step icon={<Pencil className="h-4 w-4" />} num={4} title="Spot one AI missed? Create manually.">
                  AI is a head-start, not a gate. If a moment caught your eye that AI didn't surface, open the source clip's detail and click "New brief" — fill in your own caption, suggested platform, and the source range you want to edit.
                </Step>
                <Step icon={<Pencil className="h-4 w-4" />} num={5} title="Edit in CapCut Pro">
                  For each accepted brief: open it, copy the suggested clip range and caption, then jump to CapCut Pro to do the actual cut, captioning, and brand wrap. The brief stays open in the queue so you can come back.
                </Step>
                <Step icon={<Upload className="h-4 w-4" />} num={6} title="Bring the finished file back">
                  In the same brief, click "Upload final" and select the file you exported from CapCut. It lands in the library tied to the original source — and the brief flips to "returned" status so you know it's ready to publish.
                </Step>
                <Step icon={<Send className="h-4 w-4" />} num={7} title="Attach to a post in Content Hub">
                  Finished media is reusable. The same edited clip can power a Reel today, a story next week, and a newsletter banner next month. Open Content Hub, create or pick a post, and attach the media via the Library tab in the media picker.
                </Step>
              </ol>

              <div className="rounded-md border bg-muted/40 p-3 text-xs space-y-2">
                <div className="font-medium">Patient consent</div>
                <p className="text-muted-foreground">
                  Every clinic-capture clip involves a patient on camera or audible. Verify written or recorded consent before publishing anything that includes them. The brief detail panel surfaces a reminder on every patient-involved source.
                </p>
              </div>

              <div className="rounded-md border bg-muted/40 p-3 text-xs space-y-2">
                <div className="font-medium">For clinicians</div>
                <p className="text-muted-foreground">
                  You'll see this page if you're curious or want to flag a clip for the team. Browse, search by patient pseudonym or condition, and add a note on a clip if you spot something the team should turn into content. Phillip handles the editing side.
                </p>
              </div>
            </div>

            <div className="flex items-center justify-end px-5 py-3 border-t shrink-0">
              <Button size="sm" onClick={() => setOpen(false)}>Got it</Button>
            </div>
          </div>
        </div>
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
        <div className="flex items-center gap-1.5 font-medium">
          {icon}
          <span>{title}</span>
        </div>
        <p className="text-muted-foreground mt-0.5">{children}</p>
      </div>
    </li>
  )
}
