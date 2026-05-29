import { useState, useEffect, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Loader2, Scissors, Check, X, AlertCircle, Film } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { toast } from '@/lib/toast'
import { findClips, getSegments, updateSegment, renderSegments } from '@/lib/clipsLib'

// Multi-clip video v1 (Phase 3). Embedded in the MediaDetail drawer for video
// sources: "Find clips" transcribes the source and proposes standalone ≤60s
// moments; the clinician keeps/discards and renders the kept ones into their own
// story packages (which then flow through the normal Slate review/approve loop).

function mmss(sec) {
  const s = Math.max(0, Math.round(Number(sec) || 0))
  const m = Math.floor(s / 60)
  return `${m}:${String(s % 60).padStart(2, '0')}`
}

export default function ClipFinder({ asset, canEdit }) {
  const assetId = asset.id
  const [finding, setFinding] = useState(false)
  const [rendering, setRendering] = useState(false)
  const [selected, setSelected] = useState(() => new Set())
  // Track which detection batch we've already seeded the default selection for,
  // so a poll round-trip doesn't re-check boxes the user just unchecked.
  const seededRef = useRef(null)

  const { data, refetch, isLoading } = useQuery({
    queryKey: ['video-segments', assetId],
    queryFn: () => getSegments(assetId),
    // Poll while detection runs; stop once ready/failed/idle.
    refetchInterval: (q) => (q.state.data?.status === 'detecting' ? 3000 : false),
    refetchOnWindowFocus: false,
  })

  const status = data?.status || null
  const note = data?.error || null
  const segments = data?.segments || []
  const proposed = segments.filter((s) => s.status === 'proposed')
  const rendered = segments.filter((s) => s.status === 'rendered')

  // Default-select every proposed segment when a fresh detection batch lands.
  useEffect(() => {
    if (status === 'ready' && seededRef.current !== data?.detectedAt) {
      seededRef.current = data?.detectedAt
      setSelected(new Set(proposed.map((s) => s.id)))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, data?.detectedAt, proposed.length])

  async function handleFind() {
    setFinding(true)
    try {
      await findClips(assetId)
      toast('Finding clips… transcribing the source — this can take a few minutes.')
      refetch()
    } catch (e) {
      toast.error(e?.message || 'Could not start clip detection.')
    } finally {
      setFinding(false)
    }
  }

  function toggle(id) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function handleDiscard(id) {
    // Optimistic: drop from selection, then persist + refetch.
    setSelected((prev) => { const n = new Set(prev); n.delete(id); return n })
    try {
      await updateSegment(id, 'discarded')
      refetch()
    } catch (e) {
      toast.error(e?.message || 'Could not discard segment.')
    }
  }

  async function handleCreate() {
    const ids = [...selected]
    if (!ids.length) return
    setRendering(true)
    try {
      const res = await renderSegments(ids)
      const n = res?.packages?.length || 0
      toast(n > 0
        ? `Rendering ${n} clip${n !== 1 ? 's' : ''} — track them in the Story Slate.`
        : 'No clips were queued.')
      setSelected(new Set())
      refetch()
    } catch (e) {
      toast.error(e?.message || 'Could not create clips.')
    } finally {
      setRendering(false)
    }
  }

  const detecting = status === 'detecting'
  const failed = status === 'failed'

  return (
    <div className="rounded-md border p-3 space-y-2">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <div className="text-xs font-medium flex items-center gap-1.5">
            <Scissors className="h-3.5 w-3.5 text-primary" />
            Clips from this video
            {proposed.length > 0 && (
              <Badge variant="secondary" className="text-3xs">{proposed.length}</Badge>
            )}
          </div>
          <div className="text-2xs text-muted-foreground">
            Turn this long source into several short, standalone clips.
          </div>
        </div>
        {canEdit && (
          <Button
            size="sm" variant="outline" onClick={handleFind}
            disabled={finding || detecting}
            className="h-7 gap-1.5 text-2xs"
            title="Transcribe this video and propose standalone clip moments"
          >
            {(finding || detecting)
              ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
              : <Scissors className="h-3.5 w-3.5" />}
            {proposed.length || rendered.length ? 'Find clips again' : 'Find clips'}
          </Button>
        )}
      </div>

      {/* Detecting */}
      {detecting && (
        <div className="flex items-center gap-2 text-2xs text-muted-foreground bg-muted/40 rounded px-2.5 py-2">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Transcribing + finding standalone moments… you can close this drawer; it keeps running.
        </div>
      )}

      {/* Failed */}
      {failed && (
        <div className="flex items-start gap-2 text-2xs text-destructive bg-destructive/10 rounded px-2.5 py-2">
          <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
          <span>{note || 'Clip detection failed.'} {canEdit && 'Try “Find clips” again.'}</span>
        </div>
      )}

      {/* Non-fatal note on success (e.g. long-source truncation) */}
      {status === 'ready' && note && (
        <div className="text-3xs text-muted-foreground">{note}</div>
      )}

      {/* Empty-ready */}
      {status === 'ready' && proposed.length === 0 && rendered.length === 0 && (
        <div className="text-2xs text-muted-foreground bg-muted/40 rounded px-2.5 py-2">
          No standalone moments stood out in this source. Try a longer or more content-rich recording.
        </div>
      )}

      {/* Proposed segments — keep/discard + select for rendering */}
      {proposed.length > 0 && (
        <ul className="divide-y -mx-3 border-t">
          {proposed.map((s) => {
            const isSel = selected.has(s.id)
            const len = Math.round((Number(s.end_sec) || 0) - (Number(s.start_sec) || 0))
            return (
              <li key={s.id} className="px-3 py-2 flex items-start gap-2">
                <input
                  type="checkbox"
                  checked={isSel}
                  onChange={() => toggle(s.id)}
                  disabled={!canEdit}
                  className="mt-1 h-3.5 w-3.5 accent-primary shrink-0"
                  title="Include this clip when you create clips"
                />
                <div className="min-w-0 flex-1 text-xs">
                  <div className="font-medium truncate" title={s.hook}>{s.hook || 'Untitled clip'}</div>
                  <div className="text-2xs text-muted-foreground">
                    {mmss(s.start_sec)}–{mmss(s.end_sec)} · {len}s
                  </div>
                  {s.why_it_stands_alone && (
                    <div className="text-2xs text-muted-foreground mt-0.5">{s.why_it_stands_alone}</div>
                  )}
                  {s.transcript_excerpt && (
                    <details className="mt-1">
                      <summary className="text-3xs text-muted-foreground cursor-pointer hover:text-foreground">
                        Transcript
                      </summary>
                      <p className="text-2xs text-foreground mt-0.5 whitespace-pre-wrap">{s.transcript_excerpt}</p>
                    </details>
                  )}
                </div>
                {canEdit && (
                  <button
                    type="button"
                    onClick={() => handleDiscard(s.id)}
                    title="Discard this suggestion"
                    className="shrink-0 rounded-full p-1 text-muted-foreground hover:bg-muted hover:text-destructive transition-colors"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </li>
            )
          })}
        </ul>
      )}

      {/* Create clips action */}
      {canEdit && proposed.length > 0 && (
        <div className="flex justify-end pt-1">
          <Button
            size="sm" onClick={handleCreate}
            disabled={rendering || selected.size === 0}
            className="h-7 gap-1.5 text-2xs"
          >
            {rendering ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Film className="h-3.5 w-3.5" />}
            Create {selected.size || ''} clip{selected.size === 1 ? '' : 's'}
          </Button>
        </div>
      )}

      {/* Rendered segments — already turned into story packages */}
      {rendered.length > 0 && (
        <div className="pt-1">
          <div className="text-3xs uppercase tracking-wide font-medium text-muted-foreground mb-1">
            Created clips ({rendered.length})
          </div>
          <ul className="space-y-1">
            {rendered.map((s) => (
              <li key={s.id} className="flex items-center gap-1.5 text-2xs text-muted-foreground">
                <Check className="h-3 w-3 text-emerald-600 shrink-0" />
                <span className="truncate" title={s.hook}>{s.hook || 'Clip'}</span>
                <span className="text-3xs">· {mmss(s.start_sec)}–{mmss(s.end_sec)}</span>
              </li>
            ))}
          </ul>
          <a href="/slate" className="text-2xs text-primary underline underline-offset-2 hover:opacity-80 inline-block mt-1">
            Review in Story Slate →
          </a>
        </div>
      )}

      {isLoading && !data && (
        <div className="flex justify-center py-2">
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        </div>
      )}
    </div>
  )
}
