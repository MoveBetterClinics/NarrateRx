import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { ChevronLeft, ChevronRight, ChevronUp, ChevronDown, X, Plus, Image as ImageIcon, Move } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useUpdateContentItem, useCarouselThemes } from '@/lib/queries'
import { useWorkspace } from '@/lib/WorkspaceContext'
import {
  BLOCK_ROLES,
  POSITION_PRESETS,
  SLIDE_TEMPLATES,
  TEMPLATE_DEFAULT_POSITIONS,
  renderFreeformSlide,
} from '@/lib/overlayTemplates'
import { resolveTheme } from '@/lib/carouselThemes'
import { ensureRenderedSlides } from '@/lib/renderSlides'

// Role label + chip colors. Mirrors the mockup palette.
const ROLE_META = {
  hook:        { label: 'Hook',        chip: 'bg-amber-100 text-amber-800' },
  body:        { label: 'Body',        chip: 'bg-blue-100 text-blue-800' },
  caption:     { label: 'Caption',     chip: 'bg-indigo-100 text-indigo-800' },
  cta:         { label: 'CTA',         chip: 'bg-orange-100 text-orange-800' },
  attribution: { label: 'Attribution', chip: 'bg-green-100 text-green-800' },
  page:        { label: 'Page #',      chip: 'bg-slate-200 text-slate-700' },
}

const POSITION_LABEL = {
  'top-left':      'Top L',
  'top':           'Top',
  'top-right':     'Top R',
  'center-left':   'Center L',
  'center':        'Center',
  'center-right':  'Center R',
  'bottom-left':   'Bot. L',
  'bottom':        'Bottom',
  'bottom-right':  'Bot. R',
}

function positionDisplay(pos) {
  if (pos && typeof pos === 'object' && Number.isFinite(pos.x) && Number.isFinite(pos.y)) {
    return `Custom (${Math.round(pos.x * 100)},${Math.round(pos.y * 100)})`
  }
  return POSITION_LABEL[pos] || POSITION_LABEL.center
}

// Normalize a slide loaded from the DB so the editor never has to defensively
// re-check shape. Missing fields get sensible defaults.
function normalizeSlide(s, idx) {
  return {
    photo_idx: typeof s?.photo_idx === 'number' ? s.photo_idx : idx,
    template:  typeof s?.template === 'string' && SLIDE_TEMPLATES[s.template] ? s.template : 'custom',
    blocks: Array.isArray(s?.blocks)
      ? s.blocks.map((b) => ({
          role:     typeof b?.role === 'string' && ROLE_META[b.role] ? b.role : 'body',
          text:     typeof b?.text === 'string' ? b.text : '',
          position: b?.position ?? 'center',
        }))
      : [],
  }
}

function defaultPositionFor(template, role) {
  const map = TEMPLATE_DEFAULT_POSITIONS[template] || {}
  return map[role] || 'center'
}

function emptyBlockFor(template, role) {
  return { role, text: '', position: defaultPositionFor(template, role) }
}

// ── Position picker (preset grid + custom drag) ───────────────────────────────

function PositionPickerPopover({ anchorRef, photoUrl, value, onChange, onClose }) {
  const ref = useRef(null)
  useEffect(() => {
    function handleClick(e) {
      if (ref.current && !ref.current.contains(e.target)) {
        const anchor = anchorRef?.current
        if (!anchor || !anchor.contains(e.target)) onClose()
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [anchorRef, onClose])

  const stageRef = useRef(null)
  const [dragXY, setDragXY] = useState(null)
  const isCustom = value && typeof value === 'object'

  function startDrag(e) {
    e.preventDefault()
    const stage = stageRef.current
    if (!stage) return
    function update(ev) {
      const rect = stage.getBoundingClientRect()
      const clientX = ev.touches ? ev.touches[0].clientX : ev.clientX
      const clientY = ev.touches ? ev.touches[0].clientY : ev.clientY
      const x = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
      const y = Math.max(0, Math.min(1, (clientY - rect.top) / rect.height))
      setDragXY({ x, y })
      onChange({ x, y })
    }
    function stop() {
      document.removeEventListener('mousemove', update)
      document.removeEventListener('mouseup', stop)
      document.removeEventListener('touchmove', update)
      document.removeEventListener('touchend', stop)
    }
    document.addEventListener('mousemove', update)
    document.addEventListener('mouseup', stop)
    document.addEventListener('touchmove', update)
    document.addEventListener('touchend', stop)
    update(e)
  }

  const customXY = isCustom ? value : (dragXY || { x: 0.5, y: 0.5 })

  return (
    <div
      ref={ref}
      className="absolute z-50 mt-1 w-[280px] rounded-lg border bg-white p-3 shadow-lg"
      style={{ top: '100%', left: 0 }}
    >
      <p className="mb-2 text-2xs font-semibold uppercase tracking-wide text-muted-foreground">
        Position
      </p>
      <div className="grid grid-cols-3 gap-1.5 mb-3">
        {POSITION_PRESETS.map((p) => {
          const selected = !isCustom && value === p
          return (
            <button
              key={p}
              type="button"
              onClick={() => { onChange(p); onClose() }}
              className={`aspect-square rounded border text-3xs font-medium transition-colors ${
                selected
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'border-border bg-muted/30 text-muted-foreground hover:border-primary/40 hover:text-foreground'
              }`}
            >
              {POSITION_LABEL[p]}
            </button>
          )
        })}
      </div>
      <p className="mb-1.5 text-2xs font-semibold uppercase tracking-wide text-muted-foreground">
        Custom — drag the dot
      </p>
      <div
        ref={stageRef}
        onMouseDown={startDrag}
        onTouchStart={startDrag}
        className="relative aspect-square w-full overflow-hidden rounded border bg-muted cursor-crosshair select-none"
        style={photoUrl ? { backgroundImage: `url(${photoUrl})`, backgroundSize: 'cover', backgroundPosition: 'center' } : undefined}
      >
        <div className="absolute inset-0 bg-black/25 pointer-events-none" />
        <div
          className="absolute h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary border-2 border-white shadow-lg pointer-events-none"
          style={{ left: `${customXY.x * 100}%`, top: `${customXY.y * 100}%` }}
        />
        {!isCustom && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <span className="rounded bg-black/60 px-2 py-1 text-3xs font-medium text-white">
              Click + drag to set custom position
            </span>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Block row ─────────────────────────────────────────────────────────────────

function BlockRow({ block, photoUrl, canMoveUp, canMoveDown, onChange, onMoveUp, onMoveDown, onRemove }) {
  const [posOpen, setPosOpen] = useState(false)
  const triggerRef = useRef(null)
  const meta = ROLE_META[block.role] || ROLE_META.body
  const isCustomPos = block.position && typeof block.position === 'object'

  return (
    <div className="flex items-start gap-2 rounded-md border bg-background/50 p-2">
      <div className="flex flex-col">
        <button
          type="button"
          onClick={onMoveUp}
          disabled={!canMoveUp}
          className="text-muted-foreground hover:text-foreground disabled:opacity-30"
          title="Move up"
        >
          <ChevronUp className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={onMoveDown}
          disabled={!canMoveDown}
          className="text-muted-foreground hover:text-foreground disabled:opacity-30"
          title="Move down"
        >
          <ChevronDown className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="flex-1 min-w-0">
        <div className="mb-1 flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5">
            <select
              value={block.role}
              onChange={(e) => onChange({ ...block, role: e.target.value })}
              className={`rounded-full px-2 py-0.5 text-3xs font-semibold uppercase tracking-wide ${meta.chip} border border-transparent cursor-pointer`}
            >
              {BLOCK_ROLES.map((r) => (
                <option key={r} value={r}>{ROLE_META[r]?.label || r}</option>
              ))}
            </select>
            <div className="relative">
              <button
                ref={triggerRef}
                type="button"
                onClick={() => setPosOpen((o) => !o)}
                className={`flex items-center gap-1 rounded px-1.5 py-0.5 text-3xs font-semibold uppercase tracking-wide hover:bg-muted ${
                  isCustomPos ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'
                }`}
                title="Set position"
              >
                {isCustomPos && <Move className="h-2.5 w-2.5" />}
                {positionDisplay(block.position)}
              </button>
              {posOpen && (
                <PositionPickerPopover
                  anchorRef={triggerRef}
                  photoUrl={photoUrl}
                  value={block.position}
                  onChange={(p) => onChange({ ...block, position: p })}
                  onClose={() => setPosOpen(false)}
                />
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={onRemove}
            className="text-muted-foreground hover:text-rose-600"
            title="Delete block"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
        <textarea
          value={block.text}
          onChange={(e) => onChange({ ...block, text: e.target.value })}
          rows={Math.min(4, Math.max(1, (block.text || '').split('\n').length))}
          className="w-full resize-none rounded border border-input bg-background px-2 py-1 text-xs leading-relaxed focus:outline-none focus:ring-1 focus:ring-primary/50"
          placeholder={`${meta.label} text…`}
        />
      </div>
    </div>
  )
}

// ── Slide card ────────────────────────────────────────────────────────────────

function SlidePreview({ slide, photoUrl, brandStyle, theme }) {
  const canvasRef = useRef(null)
  useEffect(() => {
    let cancelled = false
    async function draw() {
      const canvas = canvasRef.current
      if (!canvas) return
      try {
        await renderFreeformSlide({
          sourceUrl: photoUrl || null,
          slide,
          brandStyle: brandStyle || {},
          canvas,
          theme,
        })
      } catch (e) {
        if (!cancelled) console.warn('[SlidePreview] render failed', e.message)
      }
    }
    draw()
    return () => { cancelled = true }
  }, [slide, photoUrl, brandStyle, theme])

  return (
    <canvas
      ref={canvasRef}
      className="w-full aspect-square rounded-md border bg-muted"
    />
  )
}

function SlideCard({
  slide, slideIdx, totalSlides, photoUrl, mediaUrls, brandStyle, theme,
  onChange, onMoveLeft, onMoveRight, onRemove, onBindPhoto,
}) {
  function updateBlock(blockIdx, next) {
    const blocks = slide.blocks.slice()
    blocks[blockIdx] = next
    onChange({ ...slide, blocks })
  }
  function removeBlock(blockIdx) {
    const blocks = slide.blocks.slice()
    blocks.splice(blockIdx, 1)
    onChange({ ...slide, blocks })
  }
  function moveBlock(blockIdx, dir) {
    const blocks = slide.blocks.slice()
    const swap = blockIdx + dir
    if (swap < 0 || swap >= blocks.length) return
    ;[blocks[blockIdx], blocks[swap]] = [blocks[swap], blocks[blockIdx]]
    onChange({ ...slide, blocks })
  }
  function addBlock(role) {
    const blocks = slide.blocks.concat(emptyBlockFor(slide.template, role))
    onChange({ ...slide, blocks })
  }
  function changeTemplate(template) {
    // Switching templates updates default positions for blocks whose
    // current position is a preset that matches the old template default;
    // user-customized positions stay. Also gives a sensible default block
    // set if the slide was empty.
    const defaults = TEMPLATE_DEFAULT_POSITIONS[template] || {}
    const blocks = slide.blocks.length === 0
      ? (SLIDE_TEMPLATES[template]?.default_blocks || []).map((role) => emptyBlockFor(template, role))
      : slide.blocks.map((b) => {
          if (b.position && typeof b.position === 'object') return b
          const oldDefault = (TEMPLATE_DEFAULT_POSITIONS[slide.template] || {})[b.role]
          const newDefault = defaults[b.role] || 'center'
          if (b.position === oldDefault) return { ...b, position: newDefault }
          return b
        })
    onChange({ ...slide, template, blocks })
  }

  const [addOpen, setAddOpen] = useState(false)
  const [photoOpen, setPhotoOpen] = useState(false)

  return (
    <div className="w-[280px] shrink-0 rounded-xl border bg-card p-3 space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={onMoveLeft}
            disabled={slideIdx === 0}
            className="text-muted-foreground hover:text-foreground disabled:opacity-30"
            title="Move left"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="text-xs font-semibold">Slide {slideIdx + 1}</span>
          <button
            type="button"
            onClick={onMoveRight}
            disabled={slideIdx === totalSlides - 1}
            className="text-muted-foreground hover:text-foreground disabled:opacity-30"
            title="Move right"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
        <select
          value={slide.template}
          onChange={(e) => changeTemplate(e.target.value)}
          className="rounded-full bg-muted px-2 py-0.5 text-3xs font-semibold uppercase tracking-wide text-muted-foreground hover:text-foreground cursor-pointer"
        >
          {Object.entries(SLIDE_TEMPLATES).map(([k, t]) => (
            <option key={k} value={k}>{t.label}</option>
          ))}
        </select>
        <button
          type="button"
          onClick={onRemove}
          className="text-muted-foreground hover:text-rose-600"
          title="Delete slide"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <SlidePreview slide={slide} photoUrl={photoUrl} brandStyle={brandStyle} theme={theme} />

      <div className="relative">
        <button
          type="button"
          onClick={() => setPhotoOpen((o) => !o)}
          className="flex w-full items-center justify-between rounded border bg-muted/40 px-2 py-1 text-2xs hover:bg-muted"
        >
          <span className="flex items-center gap-1 text-muted-foreground">
            <ImageIcon className="h-3 w-3" />
            {photoUrl
              ? `Photo ${(slide.photo_idx ?? 0) + 1} of ${mediaUrls.length}`
              : 'No photo bound'}
          </span>
          <ChevronDown className="h-3 w-3 text-muted-foreground" />
        </button>
        {photoOpen && (
          <div className="absolute left-0 right-0 z-40 mt-1 rounded-md border bg-white p-1.5 shadow-lg max-h-48 overflow-auto">
            <button
              type="button"
              onClick={() => { onBindPhoto(null); setPhotoOpen(false) }}
              className={`flex w-full items-center gap-2 rounded px-2 py-1 text-left text-2xs hover:bg-muted ${
                slide.photo_idx === null ? 'bg-muted' : ''
              }`}
            >
              <span className="h-6 w-6 rounded bg-muted-foreground/20 flex items-center justify-center">
                <ImageIcon className="h-3 w-3 text-muted-foreground" />
              </span>
              No photo
            </button>
            {mediaUrls.map((m, idx) => (
              <button
                key={idx}
                type="button"
                onClick={() => { onBindPhoto(idx); setPhotoOpen(false) }}
                className={`flex w-full items-center gap-2 rounded px-2 py-1 text-left text-2xs hover:bg-muted ${
                  slide.photo_idx === idx ? 'bg-muted' : ''
                }`}
              >
                <img src={m.thumbnailUrl || m.url} alt="" className="h-6 w-6 rounded object-cover" />
                Photo {idx + 1}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="space-y-1.5">
        {slide.blocks.map((block, blockIdx) => (
          <BlockRow
            key={blockIdx}
            block={block}
            photoUrl={photoUrl}
            canMoveUp={blockIdx > 0}
            canMoveDown={blockIdx < slide.blocks.length - 1}
            onChange={(next) => updateBlock(blockIdx, next)}
            onMoveUp={() => moveBlock(blockIdx, -1)}
            onMoveDown={() => moveBlock(blockIdx, 1)}
            onRemove={() => removeBlock(blockIdx)}
          />
        ))}
      </div>

      <div className="relative">
        <button
          type="button"
          onClick={() => setAddOpen((o) => !o)}
          className="w-full rounded-md border border-dashed border-primary/60 bg-primary/5 px-2 py-1.5 text-2xs font-semibold text-primary hover:bg-primary/10"
        >
          <Plus className="inline h-3 w-3 -mt-0.5 mr-0.5" />
          Add text block
        </button>
        {addOpen && (
          <div className="absolute left-0 right-0 z-40 mt-1 rounded-md border bg-white p-1 shadow-lg">
            {BLOCK_ROLES.map((role) => (
              <button
                key={role}
                type="button"
                onClick={() => { addBlock(role); setAddOpen(false) }}
                className="flex w-full items-center gap-2 rounded px-2 py-1 text-left text-2xs hover:bg-muted"
              >
                <span className={`inline-block rounded-full px-1.5 py-0.5 text-3xs font-semibold uppercase tracking-wide ${ROLE_META[role].chip}`}>
                  {ROLE_META[role].label}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Top-level SlideEditor ─────────────────────────────────────────────────────

export default function SlideEditor({ piece }) {
  const workspace = useWorkspace()
  const brandStyle = workspace?.brand_style || {}
  const mediaUrls = (piece?.media_urls || []).filter((m) => m && m.type !== 'video' && m.url)
  const hasMedia = mediaUrls.length > 0

  // Seed: stored slides if any, else one empty cover slide bound to photo 0.
  function seedSlides() {
    const stored = Array.isArray(piece?.slides) ? piece.slides : null
    if (stored && stored.length > 0) return stored.map((s, i) => normalizeSlide(s, i))
    return [{ photo_idx: hasMedia ? 0 : null, template: 'cover', blocks: [] }]
  }

  const [slides, setSlides] = useState(seedSlides)
  const [savedSlidesJson, setSavedSlidesJson] = useState(() => JSON.stringify(seedSlides()))
  const [themeId, setThemeId] = useState(() => piece?.carousel_theme_id || null)

  useEffect(() => {
    const next = seedSlides()
    setSlides(next)
    setSavedSlidesJson(JSON.stringify(next))
    setThemeId(piece?.carousel_theme_id || null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [piece?.id, JSON.stringify(piece?.slides)])

  // Fetch workspace custom themes for the picker
  const { data: allThemes = [] } = useCarouselThemes()
  const customThemes = allThemes.filter((t) => t.custom)
  const theme = resolveTheme(themeId, customThemes)

  const dirty = JSON.stringify(slides) !== savedSlidesJson || themeId !== (piece?.carousel_theme_id || null)
  const updateItem = useUpdateContentItem()
  const [rendering, setRendering] = useState(false)
  const busy = updateItem.isPending || rendering

  function updateSlide(idx, next) {
    const out = slides.slice()
    out[idx] = next
    setSlides(out)
  }
  function moveSlide(idx, dir) {
    const swap = idx + dir
    if (swap < 0 || swap >= slides.length) return
    const out = slides.slice()
    ;[out[idx], out[swap]] = [out[swap], out[idx]]
    setSlides(out)
  }
  function removeSlide(idx) {
    setSlides(slides.filter((_, i) => i !== idx))
  }
  function addSlide() {
    // New slide binds to the first un-bound photo, falling back to last photo
    const usedIdxs = new Set(slides.map((s) => s.photo_idx).filter((p) => typeof p === 'number'))
    const nextPhoto = mediaUrls.findIndex((_, i) => !usedIdxs.has(i))
    setSlides(slides.concat([{
      photo_idx: nextPhoto >= 0 ? nextPhoto : (mediaUrls.length > 0 ? mediaUrls.length - 1 : null),
      template: 'custom',
      blocks: [],
    }]))
  }
  function bindPhoto(idx, photoIdx) {
    updateSlide(idx, { ...slides[idx], photo_idx: photoIdx })
  }

  async function handleSave() {
    const cleaned = slides.map((s) => ({
      photo_idx: typeof s.photo_idx === 'number' ? s.photo_idx : null,
      template:  s.template,
      blocks:    s.blocks.filter((b) => (b.text || '').trim() !== ''),
    }))

    // Bake each slide (photo + on-screen text) into an image and upload it, so
    // the overlay actually ships at publish — it previously lived only on the
    // preview canvas and never reached the post. Re-renders only changed slides.
    let toPersist = cleaned
    let renderFailed = false
    setRendering(true)
    try {
      const { slides: rendered } = await ensureRenderedSlides({
        slides:    cleaned,
        mediaUrls: piece?.media_urls,
        brandStyle,
        theme,
        themeId,
        pieceId:   piece.id,
      })
      toPersist = rendered
    } catch (e) {
      // Never lose the user's text on a render/upload hiccup — persist the slide
      // data anyway. Publish has its own render fallback, and re-saving retries.
      renderFailed = true
      console.warn('[SlideEditor] slide render failed, saving text only', e.message)
    } finally {
      setRendering(false)
    }

    try {
      await updateItem.mutateAsync({
        id: piece.id,
        patch: { slides: toPersist, carousel_theme_id: themeId || null },
      })
      setSavedSlidesJson(JSON.stringify(cleaned))
      if (renderFailed) {
        toast.error('Saved, but slide images need a retry', { description: 'Text is safe — click Save again to bake the on-screen text into the images.' })
      } else {
        toast.success('Slides saved')
      }
    } catch (e) {
      toast.error('Save failed', { description: e.message })
    }
  }

  function handleReset() {
    setSlides(JSON.parse(savedSlidesJson))
  }

  return (
    <div className="space-y-3 rounded-md border bg-card p-3">
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            On-screen text — per slide
          </p>
          <p className="mt-0.5 text-2xs text-muted-foreground">
            Each slide is one photo + freeform text blocks. Pick a role, drag-position, and bind a photo per slide.
          </p>
        </div>
        {dirty && (
          <div className="flex shrink-0 items-center gap-2">
            <Button size="sm" variant="ghost" onClick={handleReset} disabled={busy}>Reset</Button>
            <Button size="sm" onClick={handleSave} disabled={busy} loading={busy}>
              {rendering ? 'Rendering…' : updateItem.isPending ? 'Saving…' : 'Save'}
            </Button>
          </div>
        )}
      </div>

      {/* Theme picker */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-2xs font-semibold uppercase tracking-wide text-muted-foreground shrink-0">Theme</span>
        {allThemes.map((t) => {
          const active = (themeId || 'bold-dark') === t.id
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setThemeId(t.id === 'bold-dark' ? null : t.id)}
              className={`rounded-full px-2.5 py-0.5 text-2xs font-semibold transition-colors ${
                active
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted text-muted-foreground hover:bg-muted/70 hover:text-foreground'
              }`}
            >
              {t.name}
            </button>
          )
        })}
      </div>

      <div className="overflow-x-auto pb-2">
        <div className="flex gap-3 min-w-max pr-2">
          {slides.map((slide, idx) => {
            const photoUrl = typeof slide.photo_idx === 'number' && mediaUrls[slide.photo_idx]
              ? mediaUrls[slide.photo_idx].url
              : null
            return (
              <SlideCard
                key={idx}
                slide={slide}
                slideIdx={idx}
                totalSlides={slides.length}
                photoUrl={photoUrl}
                mediaUrls={mediaUrls}
                brandStyle={brandStyle}
                theme={theme}
                onChange={(next) => updateSlide(idx, next)}
                onMoveLeft={() => moveSlide(idx, -1)}
                onMoveRight={() => moveSlide(idx, 1)}
                onRemove={() => removeSlide(idx)}
                onBindPhoto={(photoIdx) => bindPhoto(idx, photoIdx)}
              />
            )
          })}
          <button
            type="button"
            onClick={addSlide}
            className="flex w-[180px] shrink-0 items-center justify-center rounded-xl border-2 border-dashed border-muted-foreground/30 bg-muted/20 text-xs font-semibold text-muted-foreground hover:border-primary/40 hover:text-primary"
          >
            <Plus className="mr-1 h-4 w-4" /> Add slide
          </button>
        </div>
      </div>
    </div>
  )
}
