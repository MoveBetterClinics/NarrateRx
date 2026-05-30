import { useState } from 'react'
import { Loader2, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { toast } from '@/lib/toast'
import { renderWholeVideo, findClips } from '@/lib/clipsLib'

// One-click "repurpose" for a long source video (social-trickle, increment A1).
// Fires BOTH lanes at once: the keep-whole full-length master render (→ Story
// Slate) AND social-clip detection (→ the "Find clips" panel below, for review).
// This is the "long format on YouTube, short cuts trickle to social" workflow as
// a single action, sitting above the two granular actions which stay available.
//
// Pure client orchestration of the two existing endpoints — the two background
// jobs are independent, so we fire both and report per-lane outcomes (a clips
// hiccup, e.g. a detection already running, must not hide the master kicking off).
export default function RepurposeAction({ asset, canEdit }) {
  const [running, setRunning] = useState(false)

  async function handleRepurpose() {
    setRunning(true)
    try {
      const [masterRes, clipsRes] = await Promise.allSettled([
        renderWholeVideo(asset.id),
        findClips(asset.id),
      ])
      const masterOk = masterRes.status === 'fulfilled'
      // A 409 (detection already running) is a benign "already started", not a failure.
      const clipsOk = clipsRes.status === 'fulfilled' || clipsRes.reason?.status === 409

      if (masterOk && clipsOk) {
        toast('Repurposing — rendering the full video and finding social clips. Track the full video in the Story Slate; review clips below.', {
          action: { label: 'Open Slate', onClick: () => { window.location.href = '/slate' } },
        })
      } else if (masterOk) {
        toast('Full video is rendering (track it in the Story Slate), but finding clips didn’t start: ' + (clipsRes.reason?.message || 'unknown error'))
      } else if (clipsOk) {
        toast('Finding social clips below, but the full-video render didn’t start: ' + (masterRes.reason?.message || 'unknown error'))
      } else {
        toast.error(masterRes.reason?.message || 'Could not start repurposing.')
      }
    } finally {
      setRunning(false)
    }
  }

  return (
    <div className="rounded-md border border-primary/30 bg-primary/5 p-3 space-y-2">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <div className="text-xs font-medium flex items-center gap-1.5">
            <Sparkles className="h-3.5 w-3.5 text-primary" />
            Repurpose this video
          </div>
          <div className="text-2xs text-muted-foreground">
            One click: render the full-length video <em>and</em> find short social clips from it.
          </div>
        </div>
        {canEdit && (
          <Button
            size="sm" onClick={handleRepurpose} disabled={running}
            className="h-7 gap-1.5 text-2xs"
            title="Render the whole source as one long-form video AND detect short social clips to review"
          >
            {running
              ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
              : <Sparkles className="h-3.5 w-3.5" />}
            Full video + social clips
          </Button>
        )}
      </div>
    </div>
  )
}
