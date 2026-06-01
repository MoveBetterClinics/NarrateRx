import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { GalleryHorizontalEnd, ArrowRight, Check, Loader2, Video, Image as ImageIcon } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { useContentItems } from '@/lib/queries'
import { PLATFORM_META } from '@/lib/contentMeta'
import { mediaKindForPlatform, mediaKindLabel } from '@/lib/platformMediaKind'

// "Needs media" = no media attached. Empty array or null both count. Kept in
// one place so the count and the list always agree.
const NEEDS_MEDIA = (p) => !Array.isArray(p?.media_urls) || p.media_urls.length === 0

// A draft is "stale" once it has waited this long without media — the cue to
// prioritize it. Drives the amber age label (vs muted for fresher drafts),
// replacing the old uniform amber "Review media" that shouted on every row.
const STALE_DAYS = 7

function firstHeading(content) {
  if (typeof content !== 'string') return ''
  const m = content.match(/^#{1,6}\s+(.+)$/m)
  return m ? m[1].trim() : ''
}

// Whole days since `iso`; null when missing/unparseable so callers can hide the
// age signal rather than render a bogus "NaNd ago".
function daysSince(iso) {
  if (!iso) return null
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return null
  return Math.floor((Date.now() - then) / 86_400_000)
}

function ageLabel(days) {
  if (days == null) return null
  if (days <= 0) return 'today'
  return `${days}d ago`
}

/**
 * Storyboard — the queue. Every written-and-ready draft that still has no
 * photo or video. Each card opens the focused Storyboard page
 * (/storyboard/:pieceId) where the producer reviews suggested media at full
 * size — plays the videos — and attaches the right one.
 *
 * The content→media tool, sibling to Slate (video→content). Ungated like
 * Library so producers (no interview.start) see it; it's their surface.
 *
 * Layout: an edge-to-edge responsive card grid (not a single capped column),
 * oldest draft first so age is the priority signal. Each card carries the
 * channel's accepted media kind and how long it's been waiting.
 */
export default function Storyboard() {
  const { data: items = [], isLoading } = useContentItems({ status: 'draft,in_review' })
  // Oldest first — age is the priority signal, so the draft that has waited
  // longest for media sits at the top of the queue.
  const rows = useMemo(
    () =>
      items
        .filter(NEEDS_MEDIA)
        .slice()
        .sort((a, b) => new Date(a.created_at || 0) - new Date(b.created_at || 0)),
    [items],
  )

  // Pieces that HAVE media but aren't published yet. Without this they'd vanish
  // from every list the moment media was attached (they leave the needs-media
  // queue but never reach a published view) — leaving no way back to finish or
  // publish them. Newest first: the one you just worked on is at the top.
  const ready = useMemo(
    () =>
      items
        .filter((p) => !NEEDS_MEDIA(p))
        .slice()
        .sort((a, b) => new Date(b.updated_at || b.created_at || 0) - new Date(a.updated_at || a.created_at || 0)),
    [items],
  )

  const nothingToShow = rows.length === 0 && ready.length === 0

  return (
    <div className="space-y-6 py-6">
      <div>
        <h1 className="flex items-center gap-2 text-xl font-semibold text-foreground">
          <GalleryHorizontalEnd className="h-5 w-5 text-primary" />
          Storyboard
        </h1>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          Drafts that need a photo or video, and the ones you’ve already given media and can take to
          publish. Open one to review the suggested media at full size — play the videos — and attach
          the right match.
        </p>
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading your drafts…
        </div>
      ) : nothingToShow ? (
        <div className="rounded-lg border bg-muted/20 py-12 text-center">
          <Check className="mx-auto h-8 w-8 text-success" />
          <p className="mt-2 text-sm font-medium text-foreground">Nothing in the Storyboard right now 🎉</p>
          <p className="text-xs text-muted-foreground">New drafts show up here when they need media.</p>
        </div>
      ) : (
        <div className="space-y-8">
          {/* Needs media — the work queue. */}
          {rows.length > 0 && (
            <section className="space-y-3">
              <p className="text-2xs font-semibold uppercase tracking-wide text-muted-foreground">
                Needs media · {rows.length}
              </p>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {rows.map((piece) => (
                  <NeedsMediaCard key={piece.id} piece={piece} />
                ))}
              </div>
            </section>
          )}

          {/* Ready to publish — has media, not yet published. The home for a
              piece after you attach media, so it never disappears on you. */}
          {ready.length > 0 && (
            <section className="space-y-3">
              <p className="text-2xs font-semibold uppercase tracking-wide text-muted-foreground">
                Ready to publish · {ready.length}
              </p>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {ready.map((piece) => (
                  <ReadyCard key={piece.id} piece={piece} />
                ))}
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  )
}

// A draft that still needs media → opens the Choose media step. Carries the age
// signal (amber once stale) and the channel's accepted media kind.
function NeedsMediaCard({ piece }) {
  const meta = PLATFORM_META[piece.platform] || { label: piece.platform }
  const Icon = meta.icon
  const title = piece.topic || firstHeading(piece.content) || 'Untitled draft'
  const kind = mediaKindForPlatform(piece.platform)
  const kindLabel = mediaKindLabel(kind)
  const days = daysSince(piece.created_at)
  const age = ageLabel(days)
  const stale = days != null && days >= STALE_DAYS
  return (
    <Link
      to={`/storyboard/${piece.id}`}
      className="group rounded-lg border bg-card p-3 transition-colors hover:border-primary/40 hover:shadow-sm"
    >
      <div className="flex items-start justify-between gap-2">
        <Badge variant="outline" className="gap-1 text-2xs">
          {Icon && <Icon className="h-3 w-3" />}{meta.label}
        </Badge>
        {age && (
          <span className={`shrink-0 text-2xs font-medium ${stale ? 'text-warning' : 'text-muted-foreground'}`}>
            {age}
          </span>
        )}
      </div>
      <p className="mt-2 text-sm font-medium leading-snug text-foreground">{title}</p>
      <div className="mt-2 flex items-center gap-2 text-2xs text-muted-foreground">
        <span className="inline-flex items-center gap-1">
          {kind === 'video' && <Video className="h-3 w-3" />}
          {kind === 'photo' && <ImageIcon className="h-3 w-3" />}
          {kindLabel}
        </span>
        {piece.staff_name && (
          <>
            <span aria-hidden>·</span>
            <span className="truncate">{piece.staff_name}</span>
          </>
        )}
      </div>
      <div className="mt-3 flex items-center justify-end">
        <span className="inline-flex items-center gap-1 text-xs font-medium text-primary">
          Add media <ArrowRight className="h-3.5 w-3.5" />
        </span>
      </div>
    </Link>
  )
}

// A piece that already has media → jumps straight to its Publish page. Shows a
// media count and a green "has media" cue so it reads as further along than the
// needs-media cards.
function ReadyCard({ piece }) {
  const meta = PLATFORM_META[piece.platform] || { label: piece.platform }
  const Icon = meta.icon
  const title = piece.topic || firstHeading(piece.content) || 'Untitled draft'
  const count = Array.isArray(piece.media_urls) ? piece.media_urls.length : 0
  return (
    <Link
      to={`/storyboard/${piece.id}/publish`}
      className="group rounded-lg border border-success/30 bg-success/5 p-3 transition-colors hover:border-success/60 hover:shadow-sm"
    >
      <div className="flex items-start justify-between gap-2">
        <Badge variant="outline" className="gap-1 text-2xs">
          {Icon && <Icon className="h-3 w-3" />}{meta.label}
        </Badge>
        <span className="inline-flex shrink-0 items-center gap-1 text-2xs font-medium text-success">
          <ImageIcon className="h-3 w-3" /> {count}
        </span>
      </div>
      <p className="mt-2 text-sm font-medium leading-snug text-foreground">{title}</p>
      <div className="mt-2 flex items-center gap-2 text-2xs text-muted-foreground">
        <span>{count} media attached</span>
        {piece.staff_name && (
          <>
            <span aria-hidden>·</span>
            <span className="truncate">{piece.staff_name}</span>
          </>
        )}
      </div>
      <div className="mt-3 flex items-center justify-end">
        <span className="inline-flex items-center gap-1 text-xs font-medium text-primary">
          Compose &amp; publish <ArrowRight className="h-3.5 w-3.5" />
        </span>
      </div>
    </Link>
  )
}
