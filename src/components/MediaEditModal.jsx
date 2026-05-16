import { useState, useRef, useEffect } from 'react'
import { Cropper } from 'react-advanced-cropper'
import 'react-advanced-cropper/dist/style.css'
import { X, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { editMediaAsset } from '@/lib/mediaLib'
import { toast } from '@/lib/toast'

const ASPECT_PRESETS = [
  { id: 'free',  label: 'Free',   ratio: null },
  { id: '1:1',   label: '1:1',    ratio: 1 },
  { id: '9:16',  label: '9:16',   ratio: 9 / 16 },
  { id: '16:9',  label: '16:9',   ratio: 16 / 9 },
  { id: '4:5',   label: '4:5',    ratio: 4 / 5 },
]

function defaultLabelFor(ratioId) {
  if (ratioId === '9:16') return '9:16 Vertical'
  if (ratioId === '1:1')  return '1:1 Square'
  if (ratioId === '16:9') return '16:9 Landscape'
  if (ratioId === '4:5')  return '4:5 Portrait'
  return ''
}

/**
 * MediaEditModal — crop an asset, producing a new variant.
 *
 * For images the cropper renders the full-resolution blob directly.
 * For videos the cropper renders the poster-frame thumbnail as a proxy and
 * scales the returned crop coordinates back to the source video's pixel
 * dimensions before sending. Videos without a thumbnail must generate one
 * first — surfaced as an inline message.
 *
 * inline=true renders without an overlay wrapper (used when the parent
 * MediaDetail is already fullscreen).
 */
export default function MediaEditModal({ asset, onClose, onSaved, inline = false }) {
  const cropperRef = useRef(null)
  // cropReady gates onChange so the cropper's automatic init fire doesn't mark
  // the crop as touched before the user has done anything.
  const cropReady = useRef(false)
  const [aspect, setAspect]       = useState('free')
  const [label,  setLabel]        = useState('')
  const [saving, setSaving]       = useState(false)
  const [error,  setError]        = useState('')
  const [cropTouched, setCropTouched] = useState(false)

  const isVideo = asset.kind === 'video'
  const previewSrc = isVideo ? asset.thumbnail_url : asset.blob_url
  const canEdit = isVideo ? !!asset.thumbnail_url : true

  useEffect(() => {
    cropReady.current = false
    setAspect('free')
    setLabel('')
    setError('')
    setCropTouched(false)
  }, [asset.id])

  useEffect(() => {
    if (label) return
    const auto = defaultLabelFor(aspect === 'free' ? null : aspect)
    if (auto) setLabel(auto)
  }, [aspect]) // eslint-disable-line react-hooks/exhaustive-deps

  function handleAspect(id) {
    setAspect(id)
    cropperRef.current?.reset?.()
    setCropTouched(true)
  }

  async function save() {
    setSaving(true); setError('')
    try {
      let crop = null
      if (cropTouched && cropperRef.current) {
        const coords = cropperRef.current.getCoordinates?.()
        if (coords && coords.width && coords.height) {
          const img = cropperRef.current.getImage?.()
          const srcW = asset.width  || img?.width  || 0
          const srcH = asset.height || img?.height || 0
          const imgW = img?.width  || srcW
          const imgH = img?.height || srcH
          crop = {
            x: Math.round(coords.left   * (srcW / imgW)),
            y: Math.round(coords.top    * (srcH / imgH)),
            w: Math.round(coords.width  * (srcW / imgW)),
            h: Math.round(coords.height * (srcH / imgH)),
          }
        }
      }
      if (!crop) {
        setError('Drag the crop handles to select an area, then save.')
        setSaving(false)
        return
      }
      const result = await editMediaAsset(asset.id, {
        rotate: 0,
        crop,
        label: label || null,
        mode: 'variant',
      })
      toast.success('Crop saved', {
        description: `Saved as "${result.asset?.variant_label || 'variant'}".`,
      })
      onSaved?.(result.asset, result.mode)
      onClose?.()
    } catch (e) {
      setError(e.message || 'Save failed')
      toast.error('Crop failed', { description: e.message })
    } finally {
      setSaving(false)
    }
  }

  const ratio = ASPECT_PRESETS.find((p) => p.id === aspect)?.ratio || null

  const editContent = (
    <>
      <div className="flex items-center justify-between px-5 py-3 border-b shrink-0">
        <div className="min-w-0">
          <h2 className="font-semibold text-sm truncate">Crop · {asset.filename}</h2>
          <p className="text-2xs text-muted-foreground">
            Select an area to save as a new variant. The original stays untouched.
          </p>
        </div>
        {!inline && (
          <Button variant="ghost" size="icon" onClick={onClose}><X className="h-4 w-4" /></Button>
        )}
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto p-5 space-y-4 flex flex-col">
        {!canEdit && (
          <div className="text-sm bg-amber-50 text-amber-900 border border-amber-200 rounded-md px-3 py-2">
            This video does not have a thumbnail yet. Close, click &quot;Make thumbnail&quot;,
            then re-open Crop. (The crop area is drawn on the poster frame.)
          </div>
        )}

        {canEdit && (
          <>
            <div className="flex-1 min-h-0 rounded-md border bg-black/95 overflow-hidden">
              <Cropper
                ref={cropperRef}
                src={previewSrc}
                className="h-full w-full"
                stencilProps={ratio ? { aspectRatio: ratio } : {}}
                onChange={() => {
                  if (!cropReady.current) { cropReady.current = true; return }
                  setCropTouched(true)
                }}
              />
            </div>

            <div className="flex flex-wrap items-center gap-2 shrink-0">
              <span className="text-xs font-medium text-muted-foreground mr-1">Aspect:</span>
              {ASPECT_PRESETS.map((p) => (
                <button
                  key={p.id}
                  onClick={() => handleAspect(p.id)}
                  className={`text-2xs px-2.5 py-1 rounded-full border transition-colors ${
                    aspect === p.id
                      ? 'bg-primary text-white border-primary'
                      : 'bg-muted text-muted-foreground border-border hover:border-primary/50'
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>

            <div className="shrink-0">
              <label className="text-xs font-medium text-muted-foreground block mb-1.5">
                Variant label
                <span className="text-muted-foreground/70 font-normal ml-1">
                  · how this variant shows up in the library
                </span>
              </label>
              <Input
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="e.g. Instagram Reel"
                className="h-8 text-sm"
                maxLength={80}
              />
            </div>

            {isVideo && (
              <p className="text-2xs text-muted-foreground shrink-0">
                Note: the crop area is drawn on the poster frame; it applies to every frame of the video.
              </p>
            )}

            {error && <div className="text-sm text-destructive shrink-0">{error}</div>}
          </>
        )}
      </div>

      <div className="flex items-center justify-end px-5 py-3 border-t shrink-0 gap-2">
        <Button variant="outline" size="sm" onClick={onClose} disabled={saving}>
          {inline ? '← Back' : 'Cancel'}
        </Button>
        <Button
          size="sm"
          onClick={save}
          disabled={saving || !canEdit}
        >
          {saving && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />}
          Save crop
        </Button>
      </div>
    </>
  )

  if (inline) {
    return <div className="flex-1 min-h-0 flex flex-col">{editContent}</div>
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
      <div className="bg-background rounded-xl shadow-2xl w-full max-w-4xl max-h-[92vh] flex flex-col">
        {editContent}
      </div>
    </div>
  )
}
