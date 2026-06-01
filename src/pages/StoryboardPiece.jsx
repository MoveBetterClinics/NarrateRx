import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowRight, ImagePlus, Sparkles, Images, Video, ImageIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import BackLink from '@/components/ui/BackLink'
import LoadingState from '@/components/LoadingState'
import ErrorState from '@/components/ErrorState'
import MediaPicker from '@/components/MediaPicker'
import DraftContextPanel from '@/components/storyboard/DraftContextPanel'
import CandidateCard from '@/components/storyboard/CandidateCard'
import MediaPreviewDialog from '@/components/storyboard/MediaPreviewDialog'
import { useContentItem, useContentItems, useMediaSuggestions, useUpdateContentItem } from '@/lib/queries'
import { clipToMediaEntry, pickerItemToMediaEntry, mediaEntryKey } from '@/lib/mediaEntry'
import { mediaKindForPlatform, mediaKindLabel, isKindMismatch } from '@/lib/platformMediaKind'
import { toast } from '@/lib/toast'

const KIND_TABS = [
  { key: 'both', label: 'Photos & video' },
  { key: 'photo', label: 'Photos' },
  { key: 'video', label: 'Videos' },
]

const NEEDS_MEDIA = (p) => !Array.isArray(p?.media_urls) || p.media_urls.length === 0

/**
 * StoryboardPiece — the focused, full-size media-approval surface for one
 * draft. Left: the draft context (what message we're matching to). Right:
 * ranked candidates as large cards; click one to play/inspect it at full size,
 * then attach. Platform-aware (a video-only channel won't be shown — or let you
 * attach — photos) plus a manual Library browse fallback.
 */
export default function StoryboardPiece() {
  const { pieceId } = useParams()
  const navigate = useNavigate()

  const { data: piece, isLoading, isError } = useContentItem(pieceId)

  // What kind of media this platform can actually publish ('video' | 'photo' |
  // null = either). Drives both the default filter and whether the producer is
  // even offered the photo/video toggle: on a video-only channel (YouTube,
  // TikTok) the toggle is hidden and the kind is locked, because attaching a
  // photo there just breaks at publish.
  const platformKind = piece ? mediaKindForPlatform(piece.platform) : null

  // Kind filter, seeded from the platform once the draft loads, overridable
  // only when the platform takes either kind. `null` until seeded so we don't
  // fire a Both query then immediately re-fire a Video one.
  const [kind, setKind] = useState(null)
  const seeded = useRef(false)
  useEffect(() => {
    if (seeded.current || !piece) return
    seeded.current = true
    setKind(platformKind === 'video' ? 'video' : platformKind === 'photo' ? 'photo' : 'both')
  }, [piece, platformKind])

  const effectiveKind = kind === 'photo' ? 'photo' : kind === 'video' ? 'video' : undefined
  const {
    data: sugg, isLoading: suggLoading, isError: suggError, refetch, isFetching,
  } = useMediaSuggestions(pieceId, { enabled: !!pieceId && kind !== null, kind: effectiveKind, k: 12 })

  const updateItem = useUpdateContentItem()
  const media = useMemo(() => (Array.isArray(piece?.media_urls) ? piece.media_urls : []), [piece])
  const attachedKeys = useMemo(() => new Set(media.map(mediaEntryKey)), [media])
  const hasMedia = media.length > 0

  const [attachingKey, setAttachingKey] = useState(null)
  const [removingKey, setRemovingKey] = useState(null)
  const [previewClip, setPreviewClip] = useState(null)
  const [pickerOpen, setPickerOpen] = useState(false)

  const attachEntry = async (entry) => {
    const key = mediaEntryKey(entry)
    if (attachedKeys.has(key)) return
    setAttachingKey(key)
    try {
      await updateItem.mutateAsync({ id: pieceId, patch: { mediaUrls: [...media, entry] } })
      toast.success('Media attached')
    } catch (e) {
      toast.error('Could not attach', { description: e?.message })
    } finally {
      setAttachingKey(null)
    }
  }

  const removeEntry = async (entry) => {
    const key = mediaEntryKey(entry)
    setRemovingKey(key)
    try {
      await updateItem.mutateAsync({ id: pieceId, patch: { mediaUrls: media.filter((m) => mediaEntryKey(m) !== key) } })
    } catch (e) {
      toast.error('Could not remove', { description: e?.message })
    } finally {
      setRemovingKey(null)
    }
  }

  const handlePicked = (assets) => {
    setPickerOpen(false)
    const incoming = (Array.isArray(assets) ? assets : [assets]).filter(Boolean).map(pickerItemToMediaEntry)
    // Guard the manual path the same way the suggestions are filtered: a
    // video-only channel can't publish a photo. Skip mismatched picks and tell
    // the producer why, rather than silently attaching media that breaks later.
    const mismatched = incoming.filter((e) => isKindMismatch(piece.platform, e.type))
    if (mismatched.length > 0) {
      toast.warning(
        `Skipped ${mismatched.length} item${mismatched.length === 1 ? '' : 's'} — this channel takes ${mediaKindLabel(platformKind).toLowerCase()}`,
      )
    }
    const fresh = incoming
      .filter((e) => !isKindMismatch(piece.platform, e.type))
      .filter((e) => !attachedKeys.has(mediaEntryKey(e)))
    if (fresh.length === 0) return
    updateItem
      .mutateAsync({ id: pieceId, patch: { mediaUrls: [...media, ...fresh] } })
      .then(() => toast.success(`Attached ${fresh.length} item${fresh.length === 1 ? '' : 's'}`))
      .catch((e) => toast.error('Could not attach', { description: e?.message }))
  }

  // "Next draft" — the next still-needs-media piece in the worklist, so a
  // producer can work the queue down without bouncing back to the list. Show
  // the remaining count so the batch has a visible finish line.
  const { data: worklist = [] } = useContentItems({ status: 'draft,in_review' })
  const remainingNeedsMedia = useMemo(
    () => worklist.filter((p) => p.id !== pieceId && NEEDS_MEDIA(p)),
    [worklist, pieceId],
  )
  const nextPieceId = remainingNeedsMedia[0]?.id || null

  if (isLoading) return <LoadingState />
  if (isError || !piece) {
    return (
      <div className="space-y-4 py-6">
        <BackLink to="/storyboard">Back to Storyboard</BackLink>
        <ErrorState message="Draft not found." />
      </div>
    )
  }

  const clips = (sugg?.clips || []).filter((c) => !attachedKeys.has(c.assetId))
  const showKindToggle = platformKind === null

  return (
    <div className="space-y-5 py-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <BackLink to="/storyboard">Back to Storyboard</BackLink>
        <div className="flex items-center gap-2">
          {piece.interview_id && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => navigate(`/stories/${piece.interview_id}?piece=${piece.id}`)}
            >
              Edit words
            </Button>
          )}
          {nextPieceId && (
            <Button variant="ghost" size="sm" onClick={() => navigate(`/storyboard/${nextPieceId}`)}>
              Next draft ({remainingNeedsMedia.length} left) <ArrowRight className="ml-1 h-3.5 w-3.5" />
            </Button>
          )}
          {/* Forward to the final step — gated on at least one attachment, since
              the whole job of this page is to give the draft media before it
              moves on. Compose (carousel/overlay/theme), preview and publish all
              live on the publish page. */}
          <Button
            size="sm"
            disabled={!hasMedia}
            title={hasMedia ? undefined : 'Attach a photo or video to continue'}
            onClick={() => navigate(`/storyboard/${piece.id}/publish`)}
          >
            Continue to publish <ArrowRight className="ml-1 h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:[grid-template-columns:minmax(0,360px)_minmax(0,1fr)]">
        {/* Left — draft context */}
        <DraftContextPanel piece={piece} onRemoveMedia={removeEntry} removingKey={removingKey} />

        {/* Right — candidates */}
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="inline-flex items-center gap-1.5 text-sm font-medium text-foreground">
              <Sparkles className="h-4 w-4 text-primary" /> Suggested media
              {hasMedia && (
                <span className="ml-1 text-xs font-normal text-muted-foreground">· {media.length} attached</span>
              )}
            </p>
            <div className="flex items-center gap-2">
              {showKindToggle ? (
                <div className="inline-flex rounded-md border p-0.5">
                  {KIND_TABS.map((t) => (
                    <button
                      key={t.key}
                      type="button"
                      onClick={() => setKind(t.key)}
                      className={`rounded px-2 py-1 text-2xs font-medium transition-colors ${
                        kind === t.key ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'
                      }`}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
              ) : (
                <span className="inline-flex items-center gap-1.5 rounded-md border bg-muted/40 px-2.5 py-1 text-2xs font-medium text-muted-foreground">
                  {platformKind === 'video' ? <Video className="h-3.5 w-3.5" /> : <ImageIcon className="h-3.5 w-3.5" />}
                  {mediaKindLabel(platformKind)} for this channel
                </span>
              )}
              <Button variant="outline" size="sm" onClick={() => setPickerOpen(true)}>
                <Images className="mr-1.5 h-3.5 w-3.5" /> Browse Library
              </Button>
            </div>
          </div>

          {suggLoading || kind === null ? (
            <CandidateGridSkeleton />
          ) : suggError ? (
            <div className="rounded-lg border bg-muted/20 py-10 text-center text-sm text-muted-foreground">
              Couldn’t load suggestions.{' '}
              <button type="button" onClick={() => refetch()} className="text-primary hover:underline">Try again</button>.
            </div>
          ) : clips.length === 0 ? (
            <div className="rounded-lg border bg-muted/20 py-10 text-center">
              <ImagePlus className="mx-auto h-7 w-7 text-muted-foreground" />
              <p className="mt-2 text-sm text-foreground">
                No strong {kind === 'video' ? 'video' : kind === 'photo' ? 'photo' : ''} matches in your Library.
              </p>
              <p className="text-xs text-muted-foreground">
                {showKindToggle ? 'Try a different type above, or ' : ''}
                <button type="button" onClick={() => setPickerOpen(true)} className="text-primary hover:underline">browse the Library</button>.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
              {clips.map((clip) => (
                <CandidateCard
                  key={clip.chunkId || clip.assetId}
                  clip={clip}
                  attached={attachedKeys.has(clip.assetId)}
                  attaching={attachingKey === clip.assetId}
                  onPreview={() => setPreviewClip(clip)}
                  onAttach={() => attachEntry(clipToMediaEntry(clip))}
                />
              ))}
            </div>
          )}
          {isFetching && !suggLoading && <p className="text-2xs text-muted-foreground">Refreshing…</p>}

          {/* Bottom forward CTA — appears once media is attached, right where the
              producer just finished working, so they don't have to scroll back
              up to the header to advance. */}
          {hasMedia && (
            <div className="flex justify-end pt-1">
              <Button size="sm" onClick={() => navigate(`/storyboard/${piece.id}/publish`)}>
                Continue to publish <ArrowRight className="ml-1 h-3.5 w-3.5" />
              </Button>
            </div>
          )}
        </div>
      </div>

      <MediaPreviewDialog
        clip={previewClip}
        open={!!previewClip}
        onOpenChange={(o) => { if (!o) setPreviewClip(null) }}
        attached={previewClip ? attachedKeys.has(previewClip.assetId) : false}
        attaching={previewClip ? attachingKey === previewClip.assetId : false}
        onAttach={() => previewClip && attachEntry(clipToMediaEntry(previewClip))}
      />

      {pickerOpen && (
        <MediaPicker multi onClose={() => setPickerOpen(false)} onSelect={handlePicked} />
      )}
    </div>
  )
}

// Skeleton grid shown while suggestions load — preserves the layout rhythm so
// the page doesn't jump from a centered spinner to a full grid.
function CandidateGridSkeleton() {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
      {Array.from({ length: 10 }).map((_, i) => (
        <div key={i} className="space-y-1.5">
          <div className="aspect-[4/3] animate-pulse rounded-lg bg-muted" />
          <div className="h-3 w-2/3 animate-pulse rounded bg-muted" />
        </div>
      ))}
    </div>
  )
}
