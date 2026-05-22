import { FileText } from 'lucide-react'

/**
 * TranscriptRail — collapsed transcript affordance shown in Edit mode.
 *
 * Sits in the left column where TranscriptPane lives in Plan mode and gives
 * back the visual real estate the expanded transcript was taking up. Clicking
 * the rail opens TranscriptDrawer for a spot lookup or selection-to-route.
 *
 * Vertical text uses writing-mode: vertical-rl + rotate(180deg) so the label
 * reads bottom-to-top, matching the orientation users expect from a side rail.
 */
export default function TranscriptRail({ onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title="Open transcript"
      aria-label="Open transcript"
      className="group h-[520px] w-11 shrink-0 flex flex-col items-center justify-start gap-3 py-3 rounded-xl border bg-card hover:bg-muted/40 transition-colors"
    >
      <FileText className="h-4 w-4 text-muted-foreground group-hover:text-foreground transition-colors" />
      <span
        className="text-xs text-muted-foreground group-hover:text-foreground transition-colors tracking-wide"
        style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)' }}
      >
        Open transcript
      </span>
    </button>
  )
}
