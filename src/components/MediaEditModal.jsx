import { useState, useRef, useEffect } from 'react'
import { Cropper } from 'react-advanced-cropper'
import 'react-advanced-cropper/dist/style.css'
import { X, RotateCcw, RotateCw, Loader2, Expand, Minimize } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { editMediaAsset } from '@/lib/mediaLib'
import { toast } from '@/lib/toast'

// Crop aspect-ratio presets (Option B from the design discussion).
const ASPECT_PRESETS = [
  { id: 'free',  label: 'Free',   ratio: null },
  { id: '1:1',   label: '1:1',    ratio: 1 },
  { id: '9:16',  label: '9:16',   ratio: 9 / 16 },
  { id: '16:9',  label: '16:9',   ratio: 16 / 9 },
  { id: '4:5',   label: '4:5',    ratio: 4 / 5 },
]

function defaultLabelFor(ratioId, rotate) {
  if (ratioId === '9:16') return '9:16 Vertical'
  if (ratioId === '1:1')  return '1:1 Square'
  if (ratioId === '16:9') return '16:9 Landscape'
  if (ratioId === '4:5')  return '4:5 Portrait'
  if (rotate && !ratioId) return `Rotated ${rotate}°`
  return ''
}

/**
 * MediaEditModal — rotate + crop an asset, producing a new variant by default
 * (or replacing the master in rotate-only cases for un-edited originals).
 *
 * For images, the cropper renders the full-resolution blob directly.
 * For videos, the cropper renders the poster-frame thumbnail as a proxy and we
 * scale the returned crop coordinates back to the source video's pixel
 * dimensions before sending. Videos without a thumbnail must generate one
 * first — surfaced as an inline message.
 */
export default function MediaEditModal({ asset, onClose, onSaved, inline = false }) {
  const cropperRef = useRef(null)
  // cropReady gates onChange so the cropper's automatic init fire doesn't mark
  // the crop as user-touched before they've done anything.
  const cropReady = useRef(false)
  const [rotate, setRotate]       = useState(0)
  const [aspect, setAspect]       = useState('free')
  const [label,  setLabel]        = useState('')
  const [saving, setSaving]       = useState(false)
  const [error,  setError]        = useState('')
  // Whether the user has intentionally interacted with the crop box.
  // Stays false until cropReady fires — keeps "Fix the original" visible
  // for pure rotation ops even though react-advanced-cropper emits onChange
  // once on mount.
  const [cropTouched, setCropTouched] = useState(false)
  const [isFullscreen, setIsFullscreen] = useState(false)

  const isVideo = asset.kind === 'video'
  const previewSrc = isVideo ? asset.thumbnail_url : asset.blob_url
  const canEdit = isVideo ? !!asset.thumbnail_url : true

  // Reset transient state if the modal opens against a different asset.
  useEffect(() => {
    cropReady.current = false
    setRotate(0)
    setAspect('free')
    setLabel('')
    setError('')
    setCropTouched(false)
  }, [asset.id])

  // Auto-fill the label from the chosen aspect preset once the user picks one.
  useEffect(() => {
    if (label) return
    const auto = defaultLabelFor(aspect === 'free' ? null : aspect, rotate)
    if (auto) setLabel(auto)
  }, [aspect, rotate]) // eslint-disable-line react-hooks/exhaustive-deps

  function handleRotate(delta) {
    cropperRef.current?.rotateImage?.(delta)
    setRotate((r) => ((r + delta) % 360 + 360) % 360)
  }

  function handleAspect(id) {
    setAspect(id)
    // Force the stencil to the new ratio. The cropper rebuilds when we change
    // stencilProps — getting the ref to refresh its coordinates is enough.
    cropperRef.current?.reset?.()
    setCropTouched(true)
  }

  async function save({ replaceMaster = false } = {}) {
    setSaving(true); setError('')
    try {
      let crop = null
      if (cropTouched && cropperRef.current) {
        const coords = cropperRef.current.getCoordinates?.()
        if (coords && coords.width && coords.height) {
          // Cropper returns coordinates in the loaded image's pixel space. For
          // videos that's the thumbnail (typically 480 wide), not the source.
          // Scale up by source.width / image.width to land in source coords.
          const img = cropperRef.current.getImage?.()
          // After rotation, image.width/height already reflect the rotated
          // frame, so source-side rotated dims must match. Source-side
          // rotated dims are (h, w) for 90/270 — we send asset.width/height
          // as-is and the server applies the same rotation reasoning.
          const rotatedSourceW = (rotate === 90 || rotate === 270)
            ? (asset.height || img?.height || 0)
            : (asset.width  || img?.width  || 0)
          const rotatedSourceH = (rotate === 90 || rotate === 270)
            ? (asset.width  || img?.width  || 0)
            : (asset.height || img?.height || 0)
          const imgW = img?.width  || rotatedSourceW
          const imgH = img?.height || rotatedSourceH
          const sx = rotatedSourceW / imgW
          const sy = rotatedSourceH / imgH
          crop = {
            x: Math.round(coords.left   * sx),
            y: Math.round(coords.top    * sy),
            w: Math.round(coords.width  * sx),
            h: Math.round(coords.height * sy),
          }
        }
      }
      if (!rotate && !crop) {
        setError('Nothing to apply — rotate or crop to enable Save.')
        setSaving(false)
        return
      }
      const result = await editMediaAsset(asset.id, {
        rotate,
        crop,
        label: label || null,
        mode: replaceMaster ? 'replace-master' : 'variant',
      })
      toast.success(
        replaceMaster ? 'Original updated' : 'Variant saved',
        { description: replaceMaster
            ? 'The original was overwritten in place.'
            : `Saved as "${result.asset?.variant_label || 'variant'}".` },
      )
      onSaved?.(result.asset, result.mode)
      onClose?.()
    } catch (e) {
      setError(e.message || 'Save failed')
      toast.error('Edit failed', { description: e.message })
    } finally {
      setSaving(false)
    }
  }

  const ratio = ASPECT_PRESETS.find((p) => p.id === aspect)?.ratio || null
  // Replace-master is only offered for rotate-only ops on a row that is itself
  // a master — fixing a wrong-orientation upload should not also leave a
  // duplicate variant around. We hide it once a crop has been touched.
  const canReplaceMaster = !asset.parent_id && rotate && !cropTouched

  const editContent = (
    <>
      <div className="flex items-center justify-between px-5 py-3 border-b shrink-0">
        <div className="min-w-0">
          <h2 className="font-semibold text-sm truncate">Edit · {asset.filename}</h2>
          <p className="text-[11px] text-muted-foreground">
            Rotate and crop. Saves as a new variant by default; the original stays untouched.
          </p>
        </div>
        {!inline && (
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="icon" onClick={() => setIsFullscreen(v => !v)} title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}>
              {isFullscreen ? <Minimize className="h-4 w-4" /> : <Expand className="h-4 w-4" />}
            </Button>
            <Button variant="ghost" size="icon" onClick={onClose}><X className="h-4 w-4" /></Button>
          </div>
        )}
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto p-5 space-y-4 flex flex-col">
        {!canEdit && (
          <div className="text-sm bg-amber-50 text-amber-900 border border-amber-200 rounded-md px-3 py-2">
            This video does not have a thumbnail yet. Close this dialog, click &quot;Make thumbnail&quot;,
            then re-open Edit. (Cropping needs a still frame to drag the crop box on.)
          </div>
        )}

        {canEdit && (
          <>
            {/* Cropper canvas */}
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

            {/* Controls */}
            <div className="flex flex-wrap items-center gap-2 shrink-0">
              <span className="text-xs font-medium text-muted-foreground mr-1">Rotate:</span>
              <Button size="sm" variant="outline" onClick={() => handleRotate(-90)} className="h-8 gap-1.5">
                <RotateCcw className="h-3.5 w-3.5" /> -90°
              </Button>
              <Button size="sm" variant="outline" onClick={() => handleRotate(90)} className="h-8 gap-1.5">
                <RotateCw className="h-3.5 w-3.5" /> +90°
              </Button>
              <span className="text-[11px] text-muted-foreground">
                Current: {rotate}°
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-2 shrink-0">
              <span className="text-xs font-medium text-muted-foreground mr-1">Aspect:</span>
              {ASPECT_PRESETS.map((p) => (
                <button
                  key={p.id}
                  onClick={() => handleAspect(p.id)}
                  className={`text-[11px] px-2.5 py-1 rounded-full border transition-colors ${
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
              <p className="text-[11px] text-muted-foreground shrink-0">
                Note: cropping is shown on the poster frame; the same crop applies to every frame of the video.
              </p>
            )}

            {error && <div className="text-sm text-destructive shrink-0">{error}</div>}
          </>
        )}
      </div>

      <div className="flex items-center justify-between px-5 py-3 border-t shrink-0">
        <div>
          {canReplaceMaster && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => save({ replaceMaster: true })}
              disabled={saving}
              title="Overwrite the original in place — use this when the upload was simply oriented wrong"
            >
              {saving && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />}
              Fix the original
            </Button>
          )}
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={onClose} disabled={saving}>
            {inline ? '← Back' : 'Cancel'}
          </Button>
          <Button
            size="sm"
            onClick={() => save({ replaceMaster: false })}
            disabled={saving || !canEdit}
          >
            {saving && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />}
            Save as variant
          </Button>
        </div>
      </div>
    </>
  )

  if (inline) {
    return <div className="flex-1 min-h-0 flex flex-col">{editContent}</div>
  }

  return (
    <div className={`fixed inset-0 z-50 bg-black/60 flex items-center justify-center ${isFullscreen ? 'p-0' : 'p-4'}`}>
      <div className={`bg-background shadow-2xl w-full flex flex-col ${isFullscreen ? 'w-screen h-screen' : 'rounded-xl max-w-4xl max-h-[92vh]'}`}>
        {editContent}
      </div>
    </div>
  )
}
