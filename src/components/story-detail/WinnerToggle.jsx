// WinnerToggle — the human "this one worked" signal for published content.
//
// V5 (engagement loop): published pieces carry a `performed_well` boolean. A
// story director flips it on when the audience responded — comments, shares,
// bookings, a partner mentioning it in clinic. That flag is the producer end
// of the loop: the Slate's Coverage tab rolls winners up per topic/clinician,
// and the daily slate resurfaces proven topics first (see getSuggestedTopics'
// provenTopics param). When GA4 / Buffer metrics eventually flow, the
// refresh-engagement cron can auto-set the same flag — this toggle is the
// manual seed that makes the loop real today.
//
// Rendered beneath BufferMetricsRow on published pieces in AssetsPane.

import { Trophy } from 'lucide-react'
import { useUpdateContentItem } from '@/lib/queries'

export default function WinnerToggle({ piece }) {
  const updateItem = useUpdateContentItem()
  const isWinner = !!piece.performed_well

  const toggle = () => {
    if (updateItem.isPending) return
    updateItem.mutate({ id: piece.id, patch: { performedWell: !isWinner } })
  }

  return (
    <div className="flex items-center gap-2 pt-1">
      <button
        type="button"
        onClick={toggle}
        disabled={updateItem.isPending}
        aria-pressed={isWinner}
        className={
          isWinner
            ? 'inline-flex items-center gap-1.5 text-xs font-semibold rounded-full px-2.5 py-1 border bg-success/10 text-success border-success/30 hover:bg-success/20 disabled:opacity-50 transition-colors'
            : 'inline-flex items-center gap-1.5 text-xs font-medium rounded-full px-2.5 py-1 border bg-muted/50 text-muted-foreground border-border hover:bg-muted hover:text-foreground disabled:opacity-50 transition-colors'
        }
        title={
          isWinner
            ? 'Marked as a winner — the audience responded. Click to unmark.'
            : 'Mark as a winner if the audience responded. Resurfaces this topic on the daily slate.'
        }
      >
        <Trophy className={`h-3.5 w-3.5 ${isWinner ? 'fill-success' : ''}`} />
        {isWinner ? 'Winner' : 'Mark as winner'}
      </button>
    </div>
  )
}
