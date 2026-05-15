import { useEffect, useMemo, useState } from 'react'
import { Sparkles, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useUpdateContentItem } from '@/lib/queries'

// Pull `[ON SCREEN TEXT: ...]` lines out of a draft body. The AI atom prompts
// emit these markers for video posts; we surface them as the suggested
// overlay text the user can accept or edit.
const MARKER_RE = /\[ON\s*SCREEN\s*TEXT:\s*([^\]]+)\]/gi

export function extractMarkerSuggestions(content) {
  if (typeof content !== 'string') return []
  const out = []
  let m
  while ((m = MARKER_RE.exec(content)) !== null) {
    const line = m[1].trim()
    if (line) out.push(line)
  }
  return out
}

function markersToOverlay(markers) {
  return {
    hook:    markers[0] || '',
    subhead: markers[1] || '',
    cta:     markers[2] || '',
  }
}

/**
 * OverlayTextEditor — edit the {hook, subhead, cta} stored on
 * content_items.overlay_text. Pre-seeds from `[ON SCREEN TEXT: …]` markers
 * found in the draft body, but manual edits always win and persist.
 */
export default function OverlayTextEditor({ piece }) {
  const updateItem = useUpdateContentItem()
  const stored = piece?.overlay_text || null
  const markers = useMemo(() => extractMarkerSuggestions(piece?.content), [piece?.content])
  const hasMarkers = markers.length > 0

  // Local edit state — debounced save on blur.
  const [hook, setHook] = useState(stored?.hook || '')
  const [subhead, setSubhead] = useState(stored?.subhead || '')
  const [cta, setCta] = useState(stored?.cta || '')

  // Re-sync local state when the piece changes (tab switch). Deps are
  // intentionally [piece?.id] only — listing stored.hook/subhead/cta would
  // re-fire this effect every time a parent optimistic update or React
  // Query refetch hands back a new piece reference, clobbering whatever
  // the user is in the middle of typing. (Same failure pattern as the
  // InterviewSession lost-interview bug: query-data seeding effects must
  // be one-shot per route param, not reactive to query refetches.)
  useEffect(() => {
    setHook(stored?.hook || '')
    setSubhead(stored?.subhead || '')
    setCta(stored?.cta || '')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [piece?.id])

  const saveOverlay = (next) =>
    updateItem.mutateAsync({ id: piece.id, patch: { overlayText: next } })

  const handleBlur = () => {
    const next = { hook: hook.trim(), subhead: subhead.trim(), cta: cta.trim() }
    const prev = { hook: (stored?.hook || '').trim(), subhead: (stored?.subhead || '').trim(), cta: (stored?.cta || '').trim() }
    if (next.hook === prev.hook && next.subhead === prev.subhead && next.cta === prev.cta) return
    // If everything is empty, store null so PostPreview hides the overlay.
    if (!next.hook && !next.subhead && !next.cta) {
      saveOverlay(null)
    } else {
      saveOverlay(next)
    }
  }

  const handleUseAiSuggestions = () => {
    const seeded = markersToOverlay(markers)
    setHook(seeded.hook)
    setSubhead(seeded.subhead)
    setCta(seeded.cta)
    saveOverlay(seeded.hook || seeded.subhead || seeded.cta ? seeded : null)
  }

  const isEmpty = !hook && !subhead && !cta
  const suggestionAvailable = hasMarkers && (
    isEmpty ||
    hook.trim() !== (markers[0] || '').trim() ||
    subhead.trim() !== (markers[1] || '').trim() ||
    cta.trim() !== (markers[2] || '').trim()
  )

  return (
    <div className="rounded-md border bg-card p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            On-screen text
          </p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            Overlay for video/image posts. Hook, subhead, and CTA stack top-to-bottom in the preview.
          </p>
        </div>
        {suggestionAvailable && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={handleUseAiSuggestions}
            disabled={updateItem.isPending}
            title="Fill from [ON SCREEN TEXT: …] markers in the draft"
          >
            {updateItem.isPending ? (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            ) : (
              <Sparkles className="mr-1.5 h-3.5 w-3.5" />
            )}
            Use AI suggestions
          </Button>
        )}
      </div>

      <div className="space-y-2">
        <div>
          <label className="mb-0.5 block text-[11px] font-medium text-muted-foreground">Hook</label>
          <Input
            value={hook}
            onChange={(e) => setHook(e.target.value)}
            onBlur={handleBlur}
            placeholder={markers[0] || 'e.g. Stop resting your back'}
            className="h-8 text-xs"
          />
        </div>
        <div>
          <label className="mb-0.5 block text-[11px] font-medium text-muted-foreground">Subhead</label>
          <Input
            value={subhead}
            onChange={(e) => setSubhead(e.target.value)}
            onBlur={handleBlur}
            placeholder={markers[1] || 'Supporting line'}
            className="h-8 text-xs"
          />
        </div>
        <div>
          <label className="mb-0.5 block text-[11px] font-medium text-muted-foreground">CTA</label>
          <Input
            value={cta}
            onChange={(e) => setCta(e.target.value)}
            onBlur={handleBlur}
            placeholder={markers[2] || 'Call to action'}
            className="h-8 text-xs"
          />
        </div>
      </div>

      {hasMarkers && (
        <p className="mt-2 text-[11px] text-muted-foreground">
          {markers.length} suggestion{markers.length === 1 ? '' : 's'} parsed from the draft.
        </p>
      )}
    </div>
  )
}
