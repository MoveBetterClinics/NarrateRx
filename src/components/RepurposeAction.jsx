import { useState } from 'react'
import { Loader2, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { toast } from '@/lib/toast'
import { repurposeVideo } from '@/lib/clipsLib'

// Repurpose A2 — one-click campaign-bundled repurpose. Calls the single
// /api/editorial/repurpose-video endpoint which: creates (or reuses) a
// "Repurpose: <filename>" campaign, kicks the keep-whole master render, and
// kicks social-clip detection — all tagged to the same campaign so the Story
// Slate's campaign chip groups master + clips together.
//
// The granular "Full-length video" and "Find clips" buttons remain available in
// MediaDetail for one-off use; this card is the "do both + bundle" shortcut.
export default function RepurposeAction({ asset, canEdit }) {
  const [running, setRunning] = useState(false)

  async function handleRepurpose() {
    setRunning(true)
    try {
      const result = await repurposeVideo(asset.id)
      const clipsAlreadyDetecting = result?.clipsStatus === 'already_detecting'
      const clipsSkipped = result?.clipsStatus === 'detection_skipped'

      if (clipsAlreadyDetecting) {
        toast('Repurposing — rendering the full video. Clip detection is already running; review clips below when it finishes.', {
          action: { label: 'Open Slate', onClick: () => { window.location.href = '/slate' } },
        })
      } else if (clipsSkipped) {
        toast('Full video is rendering (track it in the Story Slate). Clip detection could not start this time — try "Find clips" below.', {
          action: { label: 'Open Slate', onClick: () => { window.location.href = '/slate' } },
        })
      } else {
        toast('Repurposing — rendering the full video and finding social clips, all grouped under one campaign. Track the full video in the Story Slate; review clips below.', {
          action: { label: 'Open Slate', onClick: () => { window.location.href = '/slate' } },
        })
      }
    } catch (err) {
      toast.error(err?.message || 'Could not start repurposing.')
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
            One click: render the full-length video <em>and</em> find short social clips — grouped as one campaign.
          </div>
        </div>
        {canEdit && (
          <Button
            size="sm" onClick={handleRepurpose} disabled={running}
            className="h-7 gap-1.5 text-2xs"
            title="Render the whole source as one long-form video AND detect short social clips, all tagged to one campaign"
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
