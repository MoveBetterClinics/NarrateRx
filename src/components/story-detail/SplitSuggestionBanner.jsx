import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Layers, Loader2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useSplitSuggestion, useSplitBlogIntoSeries } from '@/lib/queries'
import { toast } from '@/lib/toast'

// Multi-piece extract proposal (PR 4 —
// .claude/design-interview-output-voice-fidelity.md, decision 3 + PR 4).
//
// Non-blocking, dismissible banner. After interview→blog generation the default
// is always ONE blog (it's already created). In parallel, the server detects
// whether the source interview holds enough distinct threads to be worth
// splitting. When it does (recommended_parts >= 2), we surface this proposal so
// the clinician can opt in. Accepting reuses the existing split-into-series
// pipeline (cluster + write); declining hides the banner for the session.
//
// Renders nothing unless the detection both (a) returns a >=2 recommendation
// and (b) the user hasn't dismissed it. Detection itself is gated server-side
// to eligible pieces (blog, not already a series, splittable), so this is a
// no-op on parts, atoms, published pieces, etc.

// Per-piece dismissal, scoped to the browser session so a dismissed proposal
// doesn't nag on every remount but doesn't persist forever either.
function dismissKey(id) {
  return `narraterx:split-proposal-dismissed:${id}`
}
function isDismissed(id) {
  try {
    return sessionStorage.getItem(dismissKey(id)) === '1'
  } catch {
    return false
  }
}

export default function SplitSuggestionBanner({ piece }) {
  const { data } = useSplitSuggestion(piece)
  const split = useSplitBlogIntoSeries()
  const [, setSearchParams] = useSearchParams()
  const [dismissed, setDismissed] = useState(() => isDismissed(piece?.id))

  const parts = data?.recommended_parts ?? 1
  const titles = Array.isArray(data?.titles) ? data.titles : []

  // No proposal: detection says one post, ineligible, still loading, or the
  // user already dismissed it this session.
  if (dismissed) return null
  if (!data || !data.eligible) return null
  if (parts < 2) return null

  function dismiss() {
    try {
      sessionStorage.setItem(dismissKey(piece.id), '1')
    } catch {
      // sessionStorage unavailable (private mode) — local state still hides it.
    }
    setDismissed(true)
  }

  async function handleSplit() {
    try {
      const result = await split.mutateAsync({ id: piece.id, parts })
      const n = result?.parts?.length ?? parts
      // The source piece is now archived; point the URL at the new Part 1 so
      // AssetsPane lands on a real piece instead of the stale id.
      const part1 = result?.parts?.find?.((p) => p.series_part === 1)
      if (part1?.id) {
        setSearchParams((prev) => {
          const next = new URLSearchParams(prev)
          next.set('piece', part1.id)
          return next
        }, { replace: true })
      }
      toast.success(
        `Split into ${n}-part series`,
        { description: 'New drafts created. Original blog archived for rollback.' },
      )
    } catch (e) {
      toast.error('Series generation failed', {
        description: e?.message || 'Try again — the planner sometimes needs a second pass.',
      })
    }
  }

  if (split.isPending) {
    return (
      <div className="flex items-center gap-2 rounded-md border border-info/30 bg-info/10 px-3 py-2 text-xs text-info">
        <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" />
        Planning + writing your {parts}-part series — this can take 1–3 minutes.
      </div>
    )
  }

  return (
    <div className="rounded-md border border-info/30 bg-info/10 px-3 py-2.5 text-xs space-y-2">
      <div className="flex items-start gap-2">
        <Layers className="h-4 w-4 shrink-0 text-info mt-0.5" />
        <div className="min-w-0 flex-1">
          <div className="font-medium text-foreground">
            This interview covers {parts} threads — split into {parts} posts?
          </div>
          {data.rationale && (
            <p className="mt-0.5 text-muted-foreground leading-snug">{data.rationale}</p>
          )}
          {titles.length > 0 && (
            <ul className="mt-1.5 space-y-0.5">
              {titles.map((t, i) => (
                <li key={i} className="flex gap-1.5 text-foreground/80">
                  <span className="text-muted-foreground tabular-nums">{i + 1}.</span>
                  <span className="truncate">{t}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <button
          type="button"
          onClick={dismiss}
          aria-label="Dismiss split suggestion"
          className="shrink-0 text-muted-foreground hover:text-foreground"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="flex gap-1.5 justify-end pt-1 border-t border-info/20">
        <Button size="sm" className="h-7 text-xs gap-1.5" onClick={handleSplit}>
          <Layers className="h-3 w-3" />
          Split into {parts} posts
        </Button>
        <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={dismiss}>
          Keep as one post
        </Button>
      </div>
    </div>
  )
}
