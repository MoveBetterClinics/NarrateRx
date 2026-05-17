import { useState, useEffect } from 'react'
import { Plus, X, ArrowLeft, ArrowRight, Play, Image as ImageIcon, Loader2, ChevronDown } from 'lucide-react'
import { Button } from '@/components/ui/button'
import MediaPicker from '@/components/MediaPicker'
import { useUpdateContentItem } from '@/lib/queries'
import { getAssetFamily } from '@/lib/mediaLib'

// Normalize a MediaPicker asset row into the shape stored in
// content_items.media_urls (consumed by PostPreview + the Buffer dispatcher).
function pickerItemToMediaEntry(asset) {
  const isVideo = asset.kind === 'video'
  const url     = asset.rendered_url || asset.blob_url || asset.url
  return {
    url,
    type:         isVideo ? 'video' : 'image',
    kind:         isVideo ? 'video' : 'image',
    thumbnailUrl: asset.thumbnail_url || asset.thumbnailUrl || (isVideo ? null : url),
    mediaAssetId: asset.id,
    name:         asset.filename || asset.name,
    ...(asset.duration_s != null ? { duration_s: asset.duration_s } : {}),
  }
}

// Resolve the master + variants for a given attached entry. Lazy — only
// triggers when the user clicks the variant chevron, so the cost is paid only
// when someone actually wants to swap. Returns null on rows without a
// mediaAssetId (older entries) or when the family resolution fails.
function useFamilyOnDemand(mediaAssetId) {
  const [open, setOpen]      = useState(false)
  const [family, setFamily]  = useState(null)
  const [loading, setLoading] = useState(false)

  // Close the menu when the entry id changes (e.g. user swapped to a variant).
  useEffect(() => {
    setOpen(false)
    setFamily(null)
  }, [mediaAssetId])

  async function loadAndOpen() {
    if (!mediaAssetId) return
    if (family) { setOpen((o) => !o); return }
    setLoading(true)
    try {
      const f = await getAssetFamily(mediaAssetId)
      setFamily(f)
      // Only open if there's actually something to swap to.
      const total = (f.variants?.length || 0) + (f.master ? 1 : 0)
      setOpen(total > 1)
    } catch {
      setFamily({ master: null, variants: [] })
    } finally {
      setLoading(false)
    }
  }

  return { open, setOpen, family, loading, loadAndOpen }
}

function VariantMenu({ family, currentId, onPick, onClose }) {
  // Render master first, then variants. Filter out the currently-attached row
  // so the menu only shows things the user can actually switch to.
  const items = []
  if (family?.master && family.master.id !== currentId) items.push({ asset: family.master, label: 'Original' })
  for (const v of family?.variants || []) {
    if (v.id !== currentId) items.push({ asset: v, label: v.variant_label || 'Variant' })
  }
  if (!items.length) return null
  return (
    <div className="absolute right-0 top-full z-30 mt-1 w-44 rounded-md border bg-popover shadow-md">
      <div className="px-2 py-1.5 text-3xs uppercase tracking-wide text-muted-foreground border-b">
        Use a different variant
      </div>
      <ul className="max-h-60 overflow-y-auto py-1">
        {items.map(({ asset, label }) => {
          const thumb = asset.thumbnail_url || (asset.kind === 'video' ? null : asset.blob_url)
          return (
            <li key={asset.id}>
              <button
                type="button"
                className="flex w-full items-center gap-2 px-2 py-1.5 text-left text-xs hover:bg-muted"
                onClick={() => { onPick(asset); onClose() }}
              >
                <div className="h-7 w-7 shrink-0 overflow-hidden rounded bg-muted">
                  {thumb
                    ? <img src={thumb} alt="" className="h-full w-full object-cover" />
                    : <div className="flex h-full w-full items-center justify-center text-muted-foreground">
                        {asset.kind === 'video' ? <Play className="h-3 w-3" /> : <ImageIcon className="h-3 w-3" />}
                      </div>}
                </div>
                <span className="truncate">{label}</span>
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

function MediaThumb({ entry, onRemove, onMoveLeft, onMoveRight, canMoveLeft, canMoveRight, onSwap }) {
  const isVideo = entry.type === 'video' || entry.kind === 'video'
  const thumb   = entry.thumbnailUrl || (!isVideo ? entry.url : null)
  const { open, setOpen, family, loading, loadAndOpen } = useFamilyOnDemand(entry.mediaAssetId)

  return (
    <div className="group relative h-20 w-20 shrink-0 overflow-hidden rounded-md border bg-muted">
      {thumb ? (
        <img src={thumb} alt={entry.name || ''} className="h-full w-full object-cover" />
      ) : (
        <div className="flex h-full w-full items-center justify-center text-muted-foreground">
          {isVideo ? <Play className="h-5 w-5" /> : <ImageIcon className="h-5 w-5" />}
        </div>
      )}
      {isVideo && thumb && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="rounded-full bg-black/50 p-1">
            <Play className="h-3 w-3 text-white" fill="white" />
          </div>
        </div>
      )}
      {/* Hover controls */}
      <div className="absolute inset-0 flex items-end justify-between gap-1 bg-black/40 p-1 opacity-0 transition-opacity group-hover:opacity-100">
        <button
          type="button"
          onClick={onMoveLeft}
          disabled={!canMoveLeft}
          className="rounded bg-white/90 p-0.5 text-foreground disabled:opacity-30"
          title="Move left"
        >
          <ArrowLeft className="h-3 w-3" />
        </button>
        <button
          type="button"
          onClick={onMoveRight}
          disabled={!canMoveRight}
          className="rounded bg-white/90 p-0.5 text-foreground disabled:opacity-30"
          title="Move right"
        >
          <ArrowRight className="h-3 w-3" />
        </button>
      </div>
      {/* Variant picker chevron — only renders when this entry has a known
          mediaAssetId (older attachments may lack it). Click lazy-loads the
          family; menu only opens when ≥2 family members exist, so empty
          clicks for non-variant assets give no visible feedback (acceptable —
          the user wouldn't have clicked unless they expected variants). */}
      {entry.mediaAssetId && (
        <button
          type="button"
          onClick={loadAndOpen}
          className="absolute left-0.5 top-0.5 z-10 rounded bg-black/60 p-0.5 text-white opacity-0 transition-opacity hover:bg-black/80 group-hover:opacity-100"
          title="Use a different variant"
        >
          {loading
            ? <Loader2 className="h-3 w-3 animate-spin" />
            : <ChevronDown className="h-3 w-3" />}
        </button>
      )}
      {open && family && (
        <VariantMenu
          family={family}
          currentId={entry.mediaAssetId}
          onPick={(asset) => onSwap?.(asset)}
          onClose={() => setOpen(false)}
        />
      )}
      <button
        type="button"
        onClick={onRemove}
        className="absolute right-0.5 top-0.5 rounded-full bg-black/60 p-0.5 text-white opacity-0 transition-opacity hover:bg-black/80 group-hover:opacity-100"
        title="Remove"
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  )
}

/**
 * MediaAttachmentPanel — attach/reorder/remove media on a content_items row.
 *
 * Reads piece.media_urls (jsonb array of { url, type, thumbnailUrl, ... }) and
 * writes back through useUpdateContentItem. Uses the existing MediaPicker for
 * Library + Upload tabs.
 */
export default function MediaAttachmentPanel({ piece }) {
  const [pickerOpen, setPickerOpen] = useState(false)
  const updateItem = useUpdateContentItem()

  const media = Array.isArray(piece?.media_urls) ? piece.media_urls : []

  const save = (nextMedia) =>
    updateItem.mutateAsync({ id: piece.id, patch: { mediaUrls: nextMedia } })

  const handlePicked = (assets) => {
    const incoming = (Array.isArray(assets) ? assets : [assets]).map(pickerItemToMediaEntry)
    // Dedupe by mediaAssetId/url so re-picking doesn't double-add.
    const seen = new Set(media.map((m) => m.mediaAssetId || m.url))
    const merged = [...media]
    for (const entry of incoming) {
      const key = entry.mediaAssetId || entry.url
      if (!seen.has(key)) {
        merged.push(entry)
        seen.add(key)
      }
    }
    save(merged)
    setPickerOpen(false)
  }

  const removeAt = (idx) => {
    const next = media.slice()
    next.splice(idx, 1)
    save(next)
  }

  const swap = (a, b) => {
    if (a < 0 || b < 0 || a >= media.length || b >= media.length) return
    const next = media.slice()
    ;[next[a], next[b]] = [next[b], next[a]]
    save(next)
  }

  // Swap one attached entry to a different family member (master ↔ variant).
  // Rebuilds the entry via the picker-normalization helper so the stored shape
  // matches what fresh picks produce — same downstream (PostPreview, Buffer
  // dispatcher) reads.
  const swapVariant = (idx, asset) => {
    const next = media.slice()
    next[idx] = pickerItemToMediaEntry(asset)
    save(next)
  }

  return (
    <div className="rounded-md border bg-card p-3">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Media {media.length > 0 && <span className="ml-1 text-foreground/60">({media.length})</span>}
        </p>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => setPickerOpen(true)}
          disabled={updateItem.isPending}
        >
          {updateItem.isPending ? (
            <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
          ) : (
            <Plus className="mr-1.5 h-3.5 w-3.5" />
          )}
          Attach
        </Button>
      </div>

      {media.length === 0 ? (
        <p className="text-xs italic text-muted-foreground">
          No media attached. Use Attach to pick from your Library or upload a new photo/video.
        </p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {media.map((entry, i) => (
            <MediaThumb
              key={(entry.mediaAssetId || entry.url) + ':' + i}
              entry={entry}
              onRemove={() => removeAt(i)}
              onMoveLeft={() => swap(i, i - 1)}
              onMoveRight={() => swap(i, i + 1)}
              canMoveLeft={i > 0}
              canMoveRight={i < media.length - 1}
              onSwap={(asset) => swapVariant(i, asset)}
            />
          ))}
        </div>
      )}

      {pickerOpen && (
        <MediaPicker
          multi
          onClose={() => setPickerOpen(false)}
          onSelect={handlePicked}
        />
      )}
    </div>
  )
}
