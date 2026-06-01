import { useMemo } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowRight, Eye, Video } from 'lucide-react'
import { Button } from '@/components/ui/button'
import BackLink from '@/components/ui/BackLink'
import Breadcrumb from '@/components/ui/Breadcrumb'
import { pieceLabel } from '@/lib/pieceLabel'
import { isInstagramReel } from '@/lib/mediaEntry'
import LoadingState from '@/components/LoadingState'
import ErrorState from '@/components/ErrorState'
import PostPreview from '@/components/PostPreview'
import SlideEditor from '@/components/story-detail/SlideEditor'
import BufferMetricsRow from '@/components/story-detail/BufferMetricsRow'
import WinnerToggle from '@/components/story-detail/WinnerToggle'
import { ApprovalPanel } from '@/components/story-detail/AssetsPane'
import { useContentItem, useContentItems } from '@/lib/queries'
import { PLATFORM_META } from '@/lib/contentMeta'

// Same predicate the Storyboard queue uses — a draft "needs media" when nothing
// is attached. Shared shape keeps the "Next up" count honest against the queue.
const NEEDS_MEDIA = (p) => !Array.isArray(p?.media_urls) || p.media_urls.length === 0

function firstHeading(content) {
  if (typeof content !== 'string') return ''
  const m = content.match(/^#{1,6}\s+(.+)$/m)
  return m ? m[1].trim() : ''
}

/**
 * StoryboardPublish — the final output surface for one content piece. The third
 * step of the divided flow: Stories (words) → Storyboard (media) → Publish.
 *
 * Everything needed to turn an approved, media-attached draft into a live post
 * lives here at full size: a big live preview (left), the compose controls
 * (carousel slide text + position + theme, via SlideEditor) and the
 * schedule/publish/export actions (right, via ApprovalPanel mode="publish").
 *
 * This is where the publish/compose tooling moved OUT of the cramped Stories
 * editor — so there is exactly one place to publish.
 */
export default function StoryboardPublish() {
  const { pieceId } = useParams()
  const navigate = useNavigate()
  const { data: piece, isLoading, isError } = useContentItem(pieceId)

  // Other drafts still waiting on media — drives the "Next up" loop-close so the
  // producer flows straight back into the queue after publishing one piece,
  // instead of dead-ending on a single post.
  const { data: worklist = [] } = useContentItems({ status: 'draft,in_review' })
  const remainingNeedsMedia = useMemo(
    () => worklist.filter((p) => p.id !== pieceId && NEEDS_MEDIA(p)),
    [worklist, pieceId],
  )

  if (isLoading) return <LoadingState />
  if (isError || !piece) {
    return (
      <div className="space-y-4 py-6">
        <BackLink to="/storyboard">Back to Storyboard</BackLink>
        <ErrorState message="Draft not found." />
      </div>
    )
  }

  const meta = PLATFORM_META[piece.platform] || { label: piece.platform || '—' }
  const Icon = meta.icon
  const title = piece.topic || firstHeading(piece.content) || 'Untitled draft'
  // An Instagram piece with a video attached publishes as a Reel, not a photo
  // carousel — so the photo-slide composer doesn't apply. Only show the carousel
  // composer for an Instagram piece that is NOT a reel.
  const isReel = piece.platform === 'instagram' && isInstagramReel(piece.media_urls)
  const isCarousel = piece.platform === 'instagram' && !isReel
  const mediaCount = Array.isArray(piece.media_urls) ? piece.media_urls.length : 0

  return (
    <div className="space-y-5 py-6">
      {/* Page name — stage + piece. The piece crumb links back to Choose media,
          which is also the fix for "back should return to media choices": from
          Publish you can step back to the media picker, not just the queue. */}
      <Breadcrumb
        items={[
          { label: 'Storyboard', to: '/storyboard' },
          { label: pieceLabel(piece), to: `/storyboard/${piece.id}` },
          { label: 'Publish' },
        ]}
      />

      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          {/* Back goes to the media picker for THIS piece (Choose media), not
              the queue — so you can change the attached media without losing
              the draft. "Back to Storyboard" (the queue) is still one crumb up. */}
          <BackLink to={`/storyboard/${piece.id}`}>Back to media</BackLink>
          <h1 className="mt-1 flex items-center gap-2 text-lg font-semibold text-foreground">
            {Icon && <Icon className="h-4 w-4 text-muted-foreground" />}
            <span className="truncate">{title}</span>
          </h1>
          <p className="text-xs text-muted-foreground">{meta.label} · {mediaCount} media attached</p>
        </div>
        {piece.interview_id && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate(`/stories/${piece.interview_id}?piece=${piece.id}`)}
          >
            Edit words
          </Button>
        )}
      </div>

      {/* Preview capped on the left so the compose/publish side gets the room —
          the composer's slide filmstrip + controls are the working surface, the
          preview is for reference. (Was 1fr preview / 380px controls, which made
          the editing area the cramped one.) */}
      <div className="grid grid-cols-1 gap-6 lg:[grid-template-columns:minmax(0,380px)_minmax(0,1fr)]">
        {/* Left — live preview (reference) */}
        <div className="lg:sticky lg:top-20 lg:self-start space-y-2">
          <p className="inline-flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-wide text-muted-foreground">
            <Eye className="h-3.5 w-3.5" /> Live preview
          </p>
          <div className="rounded-lg border bg-card p-3">
            <PostPreview
              platform={piece.platform}
              content={typeof piece.content === 'string' ? piece.content : JSON.stringify(piece.content)}
              mediaUrls={Array.isArray(piece.media_urls) ? piece.media_urls : []}
              slides={Array.isArray(piece.slides) ? piece.slides : null}
              overlayText={piece.overlay_text || null}
              locationOverrides={piece.location_overrides || null}
            />
          </div>
        </div>

        {/* Right — compose + publish */}
        <div className="space-y-4">
          {/* Carousel composer — slide text, placement, theme. Instagram photo
              carousels only; a Reel (video) and single-image/video platforms get
              nothing here. */}
          {isCarousel && (
            <div className="space-y-2">
              <p className="text-2xs font-semibold uppercase tracking-wide text-muted-foreground">
                Carousel slides &amp; on-screen text
              </p>
              <SlideEditor piece={piece} />
            </div>
          )}

          {/* Reel note — an Instagram video posts as a Reel, so the photo-slide
              composer doesn't apply. Any on-clip text was added upstream (Slate).
              Photos + a video can't share one Instagram post via our publisher
              (see .claude/ideas.md — mixed carousel parked, blocked on Buffer). */}
          {isReel && (
            <div className="flex items-start gap-2 rounded-lg border bg-muted/30 p-3 text-xs text-muted-foreground">
              <Video className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
              <p>
                <span className="font-medium text-foreground">This posts as a Reel.</span> A video
                publishes on its own — Instagram can’t combine a video and photos in one carousel.
                Any on-screen text is baked into the clip itself.
              </p>
            </div>
          )}

          {/* Schedule / publish / export — the consolidated output actions. */}
          <ApprovalPanel piece={piece} mode="publish" />

          {/* Next up — loop-close. After publishing this piece, point straight
              back to the Storyboard queue so the producer keeps working the
              batch down. Hidden when nothing else is waiting on media. */}
          {remainingNeedsMedia.length > 0 && (
            <Link
              to="/storyboard"
              className="group block rounded-lg border border-primary/20 bg-accent/20 p-3 transition-colors hover:border-primary/40"
            >
              <p className="mb-1 text-2xs font-semibold uppercase tracking-wide text-muted-foreground">
                Next up
              </p>
              <span className="flex items-center justify-between gap-2">
                <span className="text-sm text-foreground">
                  <b className="font-medium">
                    {remainingNeedsMedia.length} more draft{remainingNeedsMedia.length === 1 ? '' : 's'}
                  </b>{' '}
                  need media
                </span>
                <span className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-primary">
                  Storyboard <ArrowRight className="h-3.5 w-3.5" />
                </span>
              </span>
            </Link>
          )}

          {/* Post-publish metrics + "this worked" signal. */}
          {piece.status === 'published' && piece.buffer_update_id && (
            <BufferMetricsRow contentItemId={piece.id} />
          )}
          {piece.status === 'published' && <WinnerToggle piece={piece} />}
        </div>
      </div>
    </div>
  )
}
