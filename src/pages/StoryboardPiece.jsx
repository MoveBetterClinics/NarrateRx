import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, ArrowRight, Loader2, ImagePlus, Sparkles, Images } from 'lucide-react'
import { Button } from '@/components/ui/button'
import LoadingState from '@/components/LoadingState'
import ErrorState from '@/components/ErrorState'
import MediaPicker from '@/components/MediaPicker'
import DraftContextPanel from '@/components/storyboard/DraftContextPanel'
import CandidateCard from '@/components/storyboard/CandidateCard'
import MediaPreviewDialog from '@/components/storyboard/MediaPreviewDialog'
import { useContentItem, useContentItems, useMediaSuggestions, useUpdateContentItem } from '@/lib/queries'
import { clipToMediaEntry, pickerItemToMediaEntry, mediaEntryKey } from '@/lib/mediaEntry'
import { mediaKindForPlatform } from '@/lib/platformMediaKind'
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
 * then attach. Platform-aware (a video-only channel won't be shown photos) with
 * an override toggle, plus a manual Library browse fallback.
 */
export default function StoryboardPiece() {
  const { pieceId } = useParams()
  const navigate = useNavigate()

  const { data: piece, isLoading, isError } = useContentItem(pieceId)

  // Kind filter, seeded from the platform once the draft loads (video-only →
  // Videos, image surface → Photos, else Both), overridable so the producer is
  // never boxed in. `null` until seeded so we don't fire a Both query then
  // immediately re-fire a Video one.
  const [kind, setKind] = useState(null)
  const seeded = useRef(false)
  useEffect(() => {
    if (seeded.current || !piece) return
    seeded.current = true
    const pk = mediaKindForPlatform(piece.platform)
    setKind(pk === 'video' ? 'video' : pk === 'photo' ? 'photo' : 'both')
  }, [piece])

  const effectiveKind = kind === 'photo' ? 'photo' : kind === 'video' ? 'video' : undefined
  const {
    data: sugg, isLoading: suggLoading, isError: suggError, refetch, isFetching,
  } = useMediaSuggestions(pieceId, { enabled: !!pieceId && kind !== null, kind: effectiveKind, k: 12 })

  const updateItem = useUpdateContentItem()
  const media = useMemo(() => (Array.isArray(piece?.media_urls) ? piece.media_urls : []), [piece])
  const attachedKeys = useMemo(() => new Set(media.map(mediaEntryKey)), [media])

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
    const fresh = incoming.filter((e) => !attachedKeys.has(mediaEntryKey(e)))
    if (fresh.length === 0) return
    updateItem
      .mutateAsync({ id: pieceId, patch: { mediaUrls: [...media, ...fresh] } })
      .then(() => toast.success(`Attached ${fresh.length} item${fresh.length === 1 ? '' : 's'}`))
      .catch((e) => toast.error('Could not attach', { description: e?.message }))
  }

  // "Next draft" — the next still-needs-media piece in the worklist, so a
  // producer can work the queue down without bouncing back to the list.
  const { data: worklist = [] } = useContentItems({ status: 'draft,in_review' })
  const nextPieceId = useMemo(
    () => worklist.filter((p) => p.id !== pieceId && NEEDS_MEDIA(p))[0]?.id || null,
    [worklist, pieceId],
  )

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

  const clips = (sugg?.clips || []).filter((c) => !attachedKeys.has(c.assetId))

  return (
    <div className="space-y-5 py-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link to="/storyboard" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" /> Back to Storyboard
        </Link>
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
              Next draft <ArrowRight className="ml-1 h-3.5 w-3.5" />
            </Button>
          )}
          {/* Forward to the final step — compose (carousel/overlay/theme),
              preview at size, and schedule/publish all live on the publish page. */}
          <Button size="sm" onClick={() => navigate(`/storyboard/${piece.id}/publish`)}>
            Continue to publish <ArrowRight className="ml-1 h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:[grid-template-columns:minmax(0,340px)_minmax(0,1fr)]">
        {/* Left — draft context */}
        <DraftContextPanel piece={piece} onRemoveMedia={removeEntry} removingKey={removingKey} />

        {/* Right — candidates */}
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="inline-flex items-center gap-1.5 text-sm font-medium text-foreground">
              <Sparkles className="h-4 w-4 text-primary" /> Suggested media
            </p>
            <div className="flex items-center gap-2">
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
              <Button variant="outline" size="sm" onClick={() => setPickerOpen(true)}>
                <Images className="mr-1.5 h-3.5 w-3.5" /> Browse Library
              </Button>
            </div>
          </div>

          {suggLoading || kind === null ? (
            <div className="flex items-center gap-2 py-12 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Finding media that fits this draft…
            </div>
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
                Try a different type above, or{' '}
                <button type="button" onClick={() => setPickerOpen(true)} className="text-primary hover:underline">browse the Library</button>.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
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
