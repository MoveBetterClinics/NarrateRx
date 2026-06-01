import { useMemo } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowRight, Eye } from 'lucide-react'
import { Button } from '@/components/ui/button'
import BackLink from '@/components/ui/BackLink'
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
  const isCarousel = piece.platform === 'instagram'
  const mediaCount = Array.isArray(piece.media_urls) ? piece.media_urls.length : 0

  return (
    <div className="space-y-5 py-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          {/* One consistent back affordance across the per-piece stages — the
              same "Back to Storyboard" the media step uses, so the flow no
              longer drifts between "Back to media" and "Back to Storyboard". */}
          <BackLink to="/storyboard">Back to Storyboard</BackLink>
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

      <div className="grid grid-cols-1 gap-6 lg:[grid-template-columns:minmax(0,1fr)_minmax(0,380px)]">
        {/* Left — big live preview */}
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
          {/* Carousel composer — slide text, placement, theme. Instagram only;
              renders nothing for single-image/video platforms. */}
          {isCarousel && (
            <div className="space-y-2">
              <p className="text-2xs font-semibold uppercase tracking-wide text-muted-foreground">
                Carousel slides &amp; on-screen text
              </p>
              <SlideEditor piece={piece} />
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
