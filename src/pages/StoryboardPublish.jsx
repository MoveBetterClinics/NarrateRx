import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Eye } from 'lucide-react'
import { Button } from '@/components/ui/button'
import LoadingState from '@/components/LoadingState'
import ErrorState from '@/components/ErrorState'
import PostPreview from '@/components/PostPreview'
import SlideEditor from '@/components/story-detail/SlideEditor'
import BufferMetricsRow from '@/components/story-detail/BufferMetricsRow'
import WinnerToggle from '@/components/story-detail/WinnerToggle'
import { ApprovalPanel } from '@/components/story-detail/AssetsPane'
import { useContentItem } from '@/lib/queries'
import { PLATFORM_META } from '@/lib/contentMeta'

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

  if (isLoading) return <LoadingState />
  if (isError || !piece) {
    return (
      <div className="space-y-4 py-6">
        <Link to="/storyboard" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" /> Back to Storyboard
        </Link>
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
          <Link
            to={`/storyboard/${piece.id}`}
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" /> Back to media
          </Link>
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
