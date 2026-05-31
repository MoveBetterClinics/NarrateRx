import { useMemo, useRef, useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { ImagePlus, ChevronDown, ChevronRight, Check, Loader2, ExternalLink } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { useContentItems, useUpdateContentItem } from '@/lib/queries'
import { PLATFORM_META } from '@/lib/contentMeta'
import MediaSuggestions from '@/components/story-detail/MediaSuggestions'

// "Needs media" = no media attached. Empty array or null both count. This is
// the worklist predicate; keep it in one place so the count + the list agree.
const NEEDS_MEDIA = (p) => !Array.isArray(p?.media_urls) || p.media_urls.length === 0

// Fall back to the first markdown heading when a draft has no topic, so the row
// always has a human-readable label.
function firstHeading(content) {
  if (typeof content !== 'string') return ''
  const m = content.match(/^#{1,6}\s+(.+)$/m)
  return m ? m[1].trim() : ''
}

function DraftRow({ piece, onAttached }) {
  const [open, setOpen] = useState(false)
  // Track media locally so a second attach in the same session dedupes
  // correctly without mutating the shared query cache. Seeded from the row
  // (which is empty by definition for a worklist item).
  const [localMedia, setLocalMedia] = useState(
    () => (Array.isArray(piece.media_urls) ? piece.media_urls : []),
  )
  const updateItem = useUpdateContentItem()

  const baseCount = Array.isArray(piece.media_urls) ? piece.media_urls.length : 0
  const attachedThisSession = localMedia.length - baseCount

  const title = piece.topic || firstHeading(piece.content) || 'Untitled draft'
  const meta = PLATFORM_META[piece.platform] || { label: piece.platform }

  const attachedKeys = useMemo(
    () => new Set(localMedia.map((m) => m.mediaAssetId || m.url)),
    [localMedia],
  )

  const attach = async (entry) => {
    const key = entry.mediaAssetId || entry.url
    if (localMedia.some((m) => (m.mediaAssetId || m.url) === key)) return
    const next = [...localMedia, entry]
    await updateItem.mutateAsync({ id: piece.id, patch: { mediaUrls: next } })
    setLocalMedia(next)
    onAttached?.()
  }

  return (
    <div className="rounded-lg border bg-card">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-3 px-3 py-2.5 text-left"
      >
        {open
          ? <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
          : <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />}
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-foreground">{title}</p>
          <div className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
            <Badge variant="outline" className="text-2xs">{meta.label}</Badge>
            {piece.staff_name && <span className="truncate">{piece.staff_name}</span>}
          </div>
        </div>
        {attachedThisSession > 0 ? (
          <span className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-success">
            <Check className="h-3.5 w-3.5" /> {attachedThisSession} attached
          </span>
        ) : (
          <span className="shrink-0 text-xs text-amber-600">Needs media</span>
        )}
      </button>

      {open && (
        <div className="space-y-2 border-t p-3">
          <MediaSuggestions
            pieceId={piece.id}
            attachedKeys={attachedKeys}
            onAttach={attach}
            enabled
          />
          {piece.interview_id && (
            <Link
              to={`/stories/${piece.interview_id}?piece=${piece.id}`}
              className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
            >
              Open in editor <ExternalLink className="h-3 w-3" />
            </Link>
          )}
        </div>
      )}
    </div>
  )
}

/**
 * NeedsMedia — the "drafts needing media" worklist (Phase P0).
 *
 * Lists every draft / in-review piece with no media attached and lets the
 * producer attach a suggested match inline, without leaving the page. Directly
 * serves the P0 validation gate: "attach suggested media to ≥10 real drafts in
 * one sitting without leaving NarrateRx."
 */
export default function NeedsMedia() {
  const { data: items = [], isLoading } = useContentItems({ status: 'draft,in_review' })

  // Snapshot the worklist once it loads. A row that just got media would
  // otherwise drop out of the NEEDS_MEDIA filter on the next refetch and vanish
  // mid-attach — jarring when you're working down a list. We keep the row
  // visible (with an "attached" badge); the true state is re-read on reload,
  // which is also where the gate's link-rate is measured.
  const [worklist, setWorklist] = useState(null)
  const seeded = useRef(false)
  useEffect(() => {
    if (seeded.current || isLoading) return
    seeded.current = true
    setWorklist(items.filter(NEEDS_MEDIA))
  }, [isLoading, items])

  const [handled, setHandled] = useState(0)
  const rows = worklist || []

  return (
    <div className="container max-w-3xl space-y-4 py-6">
      <div>
        <h1 className="flex items-center gap-2 text-xl font-semibold text-foreground">
          <ImagePlus className="h-5 w-5 text-primary" />
          Drafts needing media
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          These drafts are written and ready, but have no photo or video attached. Pick a suggested
          match to attach it — no need to leave this page.
        </p>
      </div>

      {isLoading || worklist === null ? (
        <div className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading your drafts…
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-lg border bg-muted/20 py-12 text-center">
          <Check className="mx-auto h-8 w-8 text-success" />
          <p className="mt-2 text-sm font-medium text-foreground">Every draft has media 🎉</p>
          <p className="text-xs text-muted-foreground">Nothing waiting in the worklist right now.</p>
        </div>
      ) : (
        <>
          <p className="text-xs text-muted-foreground">
            {rows.length} draft{rows.length === 1 ? '' : 's'} in this list
            {handled > 0 && (
              <> · <span className="font-medium text-success">{handled} handled this session</span></>
            )}
          </p>
          <div className="space-y-2">
            {rows.map((piece) => (
              <DraftRow key={piece.id} piece={piece} onAttached={() => setHandled((n) => n + 1)} />
            ))}
          </div>
        </>
      )}
    </div>
  )
}
