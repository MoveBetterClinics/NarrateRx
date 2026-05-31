import { useState } from 'react'
import { Play, Image as ImageIcon, Loader2, Plus, Check, Sparkles, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useMediaSuggestions } from '@/lib/queries'

// Map a searchClips result row into the content_items.media_urls entry shape —
// the SAME shape pickerItemToMediaEntry produces, so downstream reads
// (PostPreview, Buffer dispatcher) are identical whether media was picked
// manually or attached from a suggestion. Exported so the worklist can reuse it.
export function clipToMediaEntry(clip) {
  const isVideo = clip.kind === 'video'
  const url = clip.blobUrl || clip.url
  return {
    url,
    type:         isVideo ? 'video' : 'image',
    kind:         isVideo ? 'video' : 'image',
    thumbnailUrl: clip.thumbnailUrl || (isVideo ? null : url),
    mediaAssetId: clip.assetId,
    name:         clip.filename || null,
    ...(clip.durationS != null ? { duration_s: clip.durationS } : {}),
  }
}

function topTags(aiTags, n = 4) {
  if (!Array.isArray(aiTags)) return []
  return aiTags
    .map((t) => (typeof t === 'string' ? t : t?.tag || t?.label || ''))
    .filter(Boolean)
    .slice(0, n)
}

// One candidate card. Tracks its own attach lifecycle so the button can show
// saving → attached without re-rendering the whole strip.
function SuggestionCard({ clip, alreadyAttached, onAttach }) {
  const [state, setState] = useState(alreadyAttached ? 'done' : 'idle') // idle | saving | done
  const isVideo = clip.kind === 'video'
  const thumb = clip.thumbnailUrl || (!isVideo ? clip.blobUrl : null)
  const pct = Math.round((clip.similarity || 0) * 100)
  const tags = topTags(clip.aiTags)

  const handle = async () => {
    if (state !== 'idle') return
    setState('saving')
    try {
      await onAttach(clipToMediaEntry(clip))
      setState('done')
    } catch {
      // Parent surfaces the error toast (useAppMutation); just re-enable.
      setState('idle')
    }
  }

  return (
    <div className="w-32 shrink-0 overflow-hidden rounded-md border bg-card">
      <div className="relative h-20 w-full bg-muted">
        {thumb ? (
          <img src={thumb} alt={clip.filename || ''} className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-muted-foreground">
            {isVideo ? <Play className="h-5 w-5" /> : <ImageIcon className="h-5 w-5" />}
          </div>
        )}
        {isVideo && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="rounded-full bg-black/50 p-1"><Play className="h-3 w-3 text-white" fill="white" /></div>
          </div>
        )}
        <span className="absolute left-1 top-1 rounded bg-black/60 px-1 py-0.5 text-3xs font-medium text-white">
          {pct}% match
        </span>
      </div>
      <div className="space-y-1.5 p-1.5">
        {tags.length > 0 && (
          <p className="truncate text-3xs leading-tight text-muted-foreground" title={tags.join(', ')}>
            {tags.join(' · ')}
          </p>
        )}
        <Button
          type="button"
          size="sm"
          variant={state === 'done' ? 'ghost' : 'outline'}
          className="h-6 w-full text-2xs"
          disabled={state !== 'idle'}
          onClick={handle}
        >
          {state === 'saving' ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : state === 'done' ? (
            <><Check className="mr-1 h-3 w-3 text-success" /> Attached</>
          ) : (
            <><Plus className="mr-1 h-3 w-3" /> Attach</>
          )}
        </Button>
      </div>
    </div>
  )
}

/**
 * MediaSuggestions — ranked "attach this media" candidates for a draft.
 *
 * Leads the attach experience in both surfaces (the "drafts needing media"
 * worklist and the in-editor Assets panel); the manual MediaPicker stays as the
 * fallback. Suggestions are rejectable — the producer simply doesn't pick a
 * weak one. That's the safety valve, so we err toward recall over precision.
 *
 * Props:
 *   pieceId      — content_items.id to suggest media for
 *   attachedKeys — Set of (mediaAssetId|url) already on the draft (filtered out)
 *   onAttach     — async (entry) => void; parent dedupes + persists media_urls
 *   enabled      — gate the fetch (lazy per-row in the worklist)
 */
export default function MediaSuggestions({ pieceId, attachedKeys, onAttach, enabled = true }) {
  const { data, isLoading, isError, refetch, isFetching } = useMediaSuggestions(pieceId, { enabled })

  if (!enabled) return null

  const attached = attachedKeys instanceof Set ? attachedKeys : new Set()
  const clips = (data?.clips || []).filter((c) => !attached.has(c.assetId))

  return (
    <div className="rounded-md border border-dashed bg-muted/20 p-2.5">
      <div className="mb-2 flex items-center justify-between">
        <p className="inline-flex items-center gap-1.5 text-xs font-medium text-foreground">
          <Sparkles className="h-3.5 w-3.5 text-primary" />
          Suggested media
        </p>
        <button
          type="button"
          onClick={() => refetch()}
          disabled={isFetching}
          className="inline-flex items-center gap-1 text-2xs text-muted-foreground hover:text-foreground disabled:opacity-50"
          title="Refresh suggestions"
        >
          <RefreshCw className={`h-3 w-3 ${isFetching ? 'animate-spin' : ''}`} /> Refresh
        </button>
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 py-3 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Finding media that fits this draft…
        </div>
      ) : isError ? (
        <p className="py-2 text-xs text-muted-foreground">
          Couldn’t load suggestions.{' '}
          <button type="button" onClick={() => refetch()} className="text-primary hover:underline">
            Try again
          </button>.
        </p>
      ) : clips.length === 0 ? (
        <p className="py-2 text-xs italic text-muted-foreground">
          No strong matches in your Library yet — use Attach below to search manually or upload.
        </p>
      ) : (
        <div className="flex gap-2 overflow-x-auto pb-1">
          {clips.map((clip) => (
            <SuggestionCard
              key={clip.chunkId || clip.assetId}
              clip={clip}
              alreadyAttached={attached.has(clip.assetId)}
              onAttach={onAttach}
            />
          ))}
        </div>
      )}
    </div>
  )
}
