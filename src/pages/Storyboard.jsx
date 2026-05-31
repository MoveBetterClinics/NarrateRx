import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { GalleryHorizontalEnd, ChevronRight, Check, Loader2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { useContentItems } from '@/lib/queries'
import { PLATFORM_META } from '@/lib/contentMeta'
import { mediaKindForPlatform, mediaKindLabel } from '@/lib/platformMediaKind'

// "Needs media" = no media attached. Empty array or null both count. Kept in
// one place so the count and the list always agree.
const NEEDS_MEDIA = (p) => !Array.isArray(p?.media_urls) || p.media_urls.length === 0

function firstHeading(content) {
  if (typeof content !== 'string') return ''
  const m = content.match(/^#{1,6}\s+(.+)$/m)
  return m ? m[1].trim() : ''
}

/**
 * Storyboard — the queue. Every written-and-ready draft that still has no
 * photo or video. Each row opens the focused Storyboard page
 * (/storyboard/:pieceId) where the producer reviews suggested media at full
 * size — plays the videos — and attaches the right one.
 *
 * The content→media tool, sibling to Slate (video→content). Ungated like
 * Library so producers (no interview.start) see it; it's their surface.
 */
export default function Storyboard() {
  const { data: items = [], isLoading } = useContentItems({ status: 'draft,in_review' })
  const rows = useMemo(() => items.filter(NEEDS_MEDIA), [items])

  return (
    <div className="space-y-4 py-6">
      <div>
        <h1 className="flex items-center gap-2 text-xl font-semibold text-foreground">
          <GalleryHorizontalEnd className="h-5 w-5 text-primary" />
          Storyboard
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          These drafts are written and ready, but have no photo or video. Open one to review the
          suggested media at full size — play the videos — and attach the right match.
        </p>
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading your drafts…
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-lg border bg-muted/20 py-12 text-center">
          <Check className="mx-auto h-8 w-8 text-success" />
          <p className="mt-2 text-sm font-medium text-foreground">Every draft has media 🎉</p>
          <p className="text-xs text-muted-foreground">Nothing waiting in the Storyboard right now.</p>
        </div>
      ) : (
        <>
          <p className="text-xs text-muted-foreground">
            {rows.length} draft{rows.length === 1 ? '' : 's'} need media
          </p>
          <div className="space-y-2">
            {rows.map((piece) => {
              const meta = PLATFORM_META[piece.platform] || { label: piece.platform }
              const Icon = meta.icon
              const title = piece.topic || firstHeading(piece.content) || 'Untitled draft'
              const kindHint = mediaKindLabel(mediaKindForPlatform(piece.platform))
              return (
                <Link
                  key={piece.id}
                  to={`/storyboard/${piece.id}`}
                  className="flex items-center gap-3 rounded-lg border bg-card px-3 py-2.5 transition-colors hover:border-primary/40 hover:bg-accent/20"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-foreground">{title}</p>
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                      <Badge variant="outline" className="gap-1 text-2xs">
                        {Icon && <Icon className="h-3 w-3" />}{meta.label}
                      </Badge>
                      <span className="text-2xs">· {kindHint}</span>
                      {piece.staff_name && <span className="truncate text-2xs">· {piece.staff_name}</span>}
                    </div>
                  </div>
                  <span className="shrink-0 text-xs font-medium text-amber-600">Review media</span>
                  <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                </Link>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}
