// Canvas overlay template registry.
//
// Each template is a function that draws a single 1080x1080 slide onto a
// canvas 2D context. Templates differ in layout (where text sits, how the
// photo is treated, what brand color shows up where) and in which emphasis
// types they support (hook / subhead / cta / combined).
//
// The Claude design-picker endpoint introspects TEMPLATE_DESCRIPTIONS to
// decide which template to use per slide; the ReviewPost compose flow then
// calls renderSlide() with the picker's output.
//
// To add a new template:
//   1. Add a render function below.
//   2. Register it in TEMPLATES with { supports, description }.
//   3. Add to TEMPLATE_DESCRIPTIONS for the picker prompt.
//   4. Bannerbear migration later: same picker JSON → Bannerbear modifications.

export const SIZE = 1080
const FALLBACK_ACCENT  = '#0a7f3f'
const FALLBACK_HEADING = '"Inter", "Helvetica Neue", Arial, sans-serif'
const FALLBACK_BODY    = '"Inter", "Helvetica Neue", Arial, sans-serif'

function brandFonts(brandStyle) {
  const heading = brandStyle?.heading_font ? `"${brandStyle.heading_font}", ${FALLBACK_HEADING}` : FALLBACK_HEADING
  const body    = brandStyle?.body_font    ? `"${brandStyle.body_font}", ${FALLBACK_BODY}`       : FALLBACK_BODY
  return { heading, body }
}

function brandAccent(brandStyle, fallback = FALLBACK_ACCENT) {
  return brandStyle?.accent_color || fallback
}

function wrapLines(ctx, text, maxWidth, maxLines) {
  const words = text.split(' ')
  const lines = []
  let line = ''
  for (const w of words) {
    const test = line ? `${line} ${w}` : w
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line)
      if (lines.length >= maxLines) { line = ''; break }
      line = w
    } else {
      line = test
    }
  }
  if (line) lines.push(line)
  return lines.slice(0, maxLines)
}

function drawRoundedRect(ctx, x, y, w, h, r) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.lineTo(x + w - r, y)
  ctx.arc(x + w - r, y + r, r, -Math.PI / 2, Math.PI / 2)
  ctx.lineTo(x + r, y + h)
  ctx.arc(x + r, y + r, r, Math.PI / 2, (3 * Math.PI) / 2)
  ctx.closePath()
}

// Draw source image object-cover into a region. Assumes the image element is
// already loaded (callers pre-load with crossOrigin='anonymous').
function drawCover(ctx, img, x, y, w, h) {
  const scale = Math.max(w / img.width, h / img.height)
  const sw = img.width  * scale
  const sh = img.height * scale
  ctx.save()
  ctx.beginPath()
  ctx.rect(x, y, w, h)
  ctx.clip()
  ctx.drawImage(img, x + (w - sw) / 2, y + (h - sh) / 2, sw, sh)
  ctx.restore()
}

// ── Template renderers ──────────────────────────────────────────────────────
// Each takes (ctx, { img, text, brandStyle, options }) where:
//   img         — pre-loaded HTMLImageElement
//   text        — string to render (one of hook/subhead/cta) for solo templates,
//                 or { hook, subhead, cta } object for combined templates
//   brandStyle  — workspace.brand_style JSONB
//   options     — picker's adjustments: { photoDim, colorChoice, textAlign }

function renderBoldCentered(ctx, { img, text, brandStyle, options }) {
  drawCover(ctx, img, 0, 0, SIZE, SIZE)
  const dim = options?.photoDim ?? 0.5
  ctx.fillStyle = `rgba(0,0,0,${dim})`
  ctx.fillRect(0, 0, SIZE, SIZE)

  const PAD = 80
  const isHook = options?.emphasis === 'hook'
  const display = isHook ? text.toUpperCase() : text
  const { heading } = brandFonts(brandStyle)

  ctx.font         = `bold ${isHook ? 96 : 64}px ${heading}`
  ctx.fillStyle    = 'white'
  ctx.textAlign    = 'center'
  ctx.textBaseline = 'alphabetic'

  const lineH = isHook ? 110 : 78
  const lines = wrapLines(ctx, display, SIZE - PAD * 2, isHook ? 4 : 5)
  let y = (SIZE - lines.length * lineH) / 2 + lineH * 0.75
  for (const l of lines) { ctx.fillText(l, SIZE / 2, y); y += lineH }
  ctx.textAlign = 'start'
}

function renderSplitBlock(ctx, { img, text, brandStyle, options }) {
  // Photo top half, brand-color block bottom with text
  const photoH = Math.round(SIZE * 0.55)
  drawCover(ctx, img, 0, 0, SIZE, photoH)

  const accent  = brandAccent(brandStyle)
  const useColor = options?.colorChoice === 'white' ? '#ffffff' : accent
  const textColor = options?.colorChoice === 'white' ? '#0f172a' : '#ffffff'
  ctx.fillStyle = useColor
  ctx.fillRect(0, photoH, SIZE, SIZE - photoH)

  const PAD = 64
  const blockH = SIZE - photoH
  const isHook = options?.emphasis === 'hook'
  const { heading } = brandFonts(brandStyle)
  const display = isHook ? text.toUpperCase() : text

  ctx.font         = `bold ${isHook ? 72 : 52}px ${heading}`
  ctx.fillStyle    = textColor
  ctx.textBaseline = 'alphabetic'

  const lineH = isHook ? 82 : 64
  const lines = wrapLines(ctx, display, SIZE - PAD * 2, 4)
  const totalH = lines.length * lineH
  let y = photoH + (blockH - totalH) / 2 + lineH * 0.75
  for (const l of lines) { ctx.fillText(l, PAD, y); y += lineH }
}

function renderMinimalCorner(ctx, { img, text, brandStyle, options }) {
  drawCover(ctx, img, 0, 0, SIZE, SIZE)

  // Light dim only on the band where the text sits
  const PAD = 72
  const { heading } = brandFonts(brandStyle)
  const isHook = options?.emphasis === 'hook'
  const display = isHook ? text.toUpperCase() : text
  ctx.font = `bold ${isHook ? 64 : 46}px ${heading}`
  ctx.textBaseline = 'alphabetic'

  const lineH = isHook ? 76 : 58
  const lines = wrapLines(ctx, display, SIZE - PAD * 2 - 80, 3)
  const bandH = lines.length * lineH + PAD

  // Gradient band on bottom for legibility
  const grad = ctx.createLinearGradient(0, SIZE - bandH * 1.2, 0, SIZE)
  grad.addColorStop(0, 'rgba(0,0,0,0)')
  grad.addColorStop(1, 'rgba(0,0,0,0.78)')
  ctx.fillStyle = grad
  ctx.fillRect(0, SIZE - bandH * 1.3, SIZE, bandH * 1.3)

  ctx.fillStyle = 'white'
  let y = SIZE - PAD - (lines.length - 1) * lineH
  for (const l of lines) { ctx.fillText(l, PAD, y); y += lineH }
}

function renderCtaPill(ctx, { img, text, brandStyle, options }) {
  drawCover(ctx, img, 0, 0, SIZE, SIZE)

  // Gentle bottom gradient
  const grad = ctx.createLinearGradient(0, SIZE * 0.55, 0, SIZE)
  grad.addColorStop(0, 'rgba(0,0,0,0)')
  grad.addColorStop(1, 'rgba(0,0,0,0.55)')
  ctx.fillStyle = grad
  ctx.fillRect(0, 0, SIZE, SIZE)

  const accent = brandAccent(brandStyle)
  const useAccent = options?.colorChoice !== 'white'
  const pillFill   = useAccent ? accent : '#ffffff'
  const pillText   = useAccent ? '#ffffff' : '#0f172a'

  const PAD = 80
  const { heading } = brandFonts(brandStyle)
  ctx.font = `bold 56px ${heading}`
  ctx.textBaseline = 'middle'
  ctx.textAlign    = 'center'

  const textW = ctx.measureText(text).width
  const pillW = Math.min(textW + 96, SIZE - PAD * 2)
  const pillH = 100
  const pillX = (SIZE - pillW) / 2
  const pillY = SIZE - PAD - pillH

  ctx.fillStyle = pillFill
  drawRoundedRect(ctx, pillX, pillY, pillW, pillH, pillH / 2)
  ctx.fill()

  ctx.fillStyle = pillText
  ctx.fillText(text, SIZE / 2, pillY + pillH / 2)
  ctx.textAlign = 'start'
}

// Combined templates — render hook + subhead + cta together
function renderBottomStack(ctx, { img, text, brandStyle, options }) {
  drawCover(ctx, img, 0, 0, SIZE, SIZE)
  const grad = ctx.createLinearGradient(0, SIZE * 0.45, 0, SIZE)
  grad.addColorStop(0, 'rgba(0,0,0,0)')
  grad.addColorStop(1, `rgba(0,0,0,${options?.photoDim ?? 0.8})`)
  ctx.fillStyle = grad
  ctx.fillRect(0, 0, SIZE, SIZE)

  const PAD  = 72
  const maxW = SIZE - PAD * 2
  const { heading, body } = brandFonts(brandStyle)
  const accent = brandAccent(brandStyle)
  let bottomY = SIZE - PAD

  // CTA pill
  if (text.cta) {
    ctx.font = `bold 34px ${heading}`
    ctx.textBaseline = 'middle'
    const useAccent = options?.colorChoice === 'accent'
    const pillFill = useAccent ? accent : 'rgba(255,255,255,0.18)'
    const pillStroke = useAccent ? accent : 'rgba(255,255,255,0.45)'
    const pillTextColor = useAccent ? 'white' : 'white'
    const pillW = Math.min(ctx.measureText(text.cta).width + 64, maxW)
    const pillH = 54
    const pillY = bottomY - pillH
    ctx.fillStyle = pillFill
    ctx.strokeStyle = pillStroke
    ctx.lineWidth = 2
    drawRoundedRect(ctx, PAD, pillY, pillW, pillH, pillH / 2)
    ctx.fill()
    if (!useAccent) ctx.stroke()
    ctx.fillStyle = pillTextColor
    ctx.fillText(text.cta, PAD + 32, pillY + pillH / 2)
    bottomY = pillY - 28
  }

  // Subhead
  if (text.subhead) {
    ctx.font = `400 38px ${body}`
    ctx.textBaseline = 'alphabetic'
    ctx.fillStyle = 'rgba(255,255,255,0.88)'
    const lines = wrapLines(ctx, text.subhead, maxW, 2)
    const lineH = 52
    bottomY -= lines.length * lineH
    let y = bottomY
    for (const l of lines) { ctx.fillText(l, PAD, y); y += lineH }
    bottomY -= 24
  }

  // Hook
  if (text.hook) {
    ctx.font = `bold 68px ${heading}`
    ctx.textBaseline = 'alphabetic'
    ctx.fillStyle = 'white'
    const lines = wrapLines(ctx, text.hook.toUpperCase(), maxW, 2)
    const lineH = 84
    bottomY -= lines.length * lineH
    let y = bottomY
    for (const l of lines) { ctx.fillText(l, PAD, y); y += lineH }
  }
}

function renderCenteredDramatic(ctx, { img, text, brandStyle, options }) {
  drawCover(ctx, img, 0, 0, SIZE, SIZE)
  ctx.fillStyle = `rgba(0,0,0,${options?.photoDim ?? 0.6})`
  ctx.fillRect(0, 0, SIZE, SIZE)

  const PAD = 80
  const maxW = SIZE - PAD * 2
  const { heading, body } = brandFonts(brandStyle)
  const accent = brandAccent(brandStyle)
  ctx.textAlign = 'center'
  ctx.textBaseline = 'alphabetic'

  // Vertical layout: hook (center-top), subhead (center-mid), cta pill (center-low)
  let y = SIZE / 2 - 160

  if (text.hook) {
    ctx.font = `bold 84px ${heading}`
    ctx.fillStyle = 'white'
    const lines = wrapLines(ctx, text.hook.toUpperCase(), maxW, 3)
    const lineH = 96
    y -= (lines.length - 1) * lineH / 2
    for (const l of lines) { ctx.fillText(l, SIZE / 2, y); y += lineH }
    y += 24
  }

  if (text.subhead) {
    ctx.font = `400 40px ${body}`
    ctx.fillStyle = 'rgba(255,255,255,0.85)'
    const lines = wrapLines(ctx, text.subhead, maxW, 2)
    const lineH = 56
    for (const l of lines) { ctx.fillText(l, SIZE / 2, y); y += lineH }
    y += 36
  }

  if (text.cta) {
    ctx.font = `bold 38px ${heading}`
    ctx.textBaseline = 'middle'
    const pillFill = accent
    const pillW = Math.min(ctx.measureText(text.cta).width + 64, maxW)
    const pillH = 64
    const pillX = (SIZE - pillW) / 2
    ctx.fillStyle = pillFill
    drawRoundedRect(ctx, pillX, y, pillW, pillH, pillH / 2)
    ctx.fill()
    ctx.fillStyle = 'white'
    ctx.fillText(text.cta, SIZE / 2, y + pillH / 2)
  }
  ctx.textAlign = 'start'
}

// ── Registry ────────────────────────────────────────────────────────────────

export const TEMPLATES = {
  bold_centered: {
    supports: ['hook', 'subhead', 'cta'],
    combined: false,
    render: renderBoldCentered,
  },
  split_block: {
    supports: ['hook', 'subhead', 'cta'],
    combined: false,
    render: renderSplitBlock,
  },
  minimal_corner: {
    supports: ['hook', 'subhead', 'cta'],
    combined: false,
    render: renderMinimalCorner,
  },
  cta_pill: {
    supports: ['cta'],
    combined: false,
    render: renderCtaPill,
  },
  bottom_stack: {
    supports: ['combined'],
    combined: true,
    render: renderBottomStack,
  },
  centered_dramatic: {
    supports: ['combined'],
    combined: true,
    render: renderCenteredDramatic,
  },
}

// Plain-text descriptions for the Claude picker prompt. Keep short — the model
// only needs enough to make a sensible choice. Layout details are abstracted
// to "what it looks like + when to use it" rather than pixel specifics.
export const TEMPLATE_DESCRIPTIONS = {
  bold_centered:     'Photo darkened, single line of large bold text centered. Strong for hook/myth-buster posts. Works on any photo.',
  split_block:       'Photo top half, solid-color block (brand accent or white) bottom half with bold text. Editorial feel. Works when photo subject is in the top half.',
  minimal_corner:    'Photo full-bleed with subtle gradient at bottom, smaller text bottom-left. Use when the photo is the message and text supports it.',
  cta_pill:          'Full-bleed photo with prominent brand-color CTA pill button centered low. CTA-only slides.',
  bottom_stack:      'All three elements stacked at bottom with gradient — hook (largest), subhead, CTA pill. The classic combined layout.',
  centered_dramatic: 'All three elements centered vertically, heavier photo dim, accent-color CTA pill. High-impact "stop scrolling" combined layout.',
}

// Human-readable labels for the customize panel dropdown.
export const TEMPLATE_LABELS = {
  bold_centered:     'Bold centered',
  split_block:       'Split block',
  minimal_corner:    'Minimal corner',
  cta_pill:          'CTA pill',
  bottom_stack:      'Bottom stack',
  centered_dramatic: 'Centered dramatic',
}

// Returns template ids compatible with a given emphasis (one of
// 'hook' | 'subhead' | 'cta' | 'combined'). Used by the customize panel
// to populate the template dropdown for each composed slide.
export function getCompatibleTemplates(emphasis) {
  const isCombined = emphasis === 'combined'
  return Object.entries(TEMPLATES)
    .filter(([, t]) => t.combined === isCombined && t.supports.includes(emphasis))
    .map(([id]) => id)
}

// ── Freeform per-slide text blocks ──────────────────────────────────────────
// Drives the per-slide editor + preview. Each slide is a photo + N text
// blocks; each block has a role (drives typography) and a position (preset
// key or { x, y } fraction). Position presets always map to the rendered
// edges with a consistent safe-area PAD so text never collides with chrome.

const FREEFORM_PAD = 64

export const POSITION_PRESETS = [
  'top-left', 'top', 'top-right',
  'center-left', 'center', 'center-right',
  'bottom-left', 'bottom', 'bottom-right',
]

export const BLOCK_ROLES = ['hook', 'body', 'caption', 'cta', 'attribution', 'page']

// Per-role typography. Sizes are tuned for the 1080×1080 SIZE; the renderer
// scales the canvas back down for the in-editor preview.
function roleTypography(role, brandStyle) {
  const { heading, body } = brandFonts(brandStyle)
  switch (role) {
    case 'hook':
      return { font: `bold 84px ${heading}`, lineH: 96, color: 'white', uppercase: true,
               maxLines: 4, shadow: true, maxWidthFrac: 0.86 }
    case 'body':
      return { font: `600 44px ${body}`, lineH: 56, color: 'white', uppercase: false,
               maxLines: 5, shadow: true, maxWidthFrac: 0.86 }
    case 'caption':
      return { font: `italic 500 36px ${body}`, lineH: 46, color: 'rgba(255,255,255,0.92)', uppercase: false,
               maxLines: 3, shadow: true, maxWidthFrac: 0.86 }
    case 'cta':
      return { font: `bold 42px ${heading}`, lineH: 0, color: 'white', uppercase: false,
               maxLines: 1, pill: true, maxWidthFrac: 0.82 }
    case 'attribution':
      return { font: `500 30px ${body}`, lineH: 38, color: 'rgba(255,255,255,0.9)', uppercase: false,
               maxLines: 2, shadow: true, maxWidthFrac: 0.7 }
    case 'page':
      return { font: `600 28px ${body}`, lineH: 34, color: 'rgba(255,255,255,0.85)', uppercase: false,
               maxLines: 1, shadow: true, maxWidthFrac: 0.3 }
    default:
      return { font: `500 36px ${body}`, lineH: 46, color: 'white', uppercase: false,
               maxLines: 3, shadow: true, maxWidthFrac: 0.86 }
  }
}

// Resolve a position spec to { anchorX, anchorY, align } in canvas pixels.
// Preset keys snap to a 3×3 grid inset by FREEFORM_PAD. Custom {x,y} is the
// fraction of the canvas (0..1) for the block's anchor point, where the
// anchor sits at the block's text-bottom-left for left/start aligns and
// text-bottom-center for centered aligns.
function resolvePosition(position) {
  if (position && typeof position === 'object' && Number.isFinite(position.x) && Number.isFinite(position.y)) {
    const x = Math.max(0, Math.min(1, position.x))
    const y = Math.max(0, Math.min(1, position.y))
    // Custom: align by which third of the canvas the anchor sits in
    const align = x < 0.34 ? 'left' : x > 0.66 ? 'right' : 'center'
    return { anchorX: Math.round(x * SIZE), anchorY: Math.round(y * SIZE), align }
  }
  const preset = typeof position === 'string' ? position : 'center'
  const [vert, horiz] = preset.includes('-') ? preset.split('-') : [preset, null]
  const colName = horiz || (vert === 'center' ? 'center' : 'center')
  const rowName = (vert === 'top' || vert === 'bottom' || vert === 'center') ? vert : 'center'
  const x = colName === 'left'  ? FREEFORM_PAD
          : colName === 'right' ? SIZE - FREEFORM_PAD
          :                       SIZE / 2
  const y = rowName === 'top'    ? FREEFORM_PAD * 1.5
          : rowName === 'bottom' ? SIZE - FREEFORM_PAD
          :                        SIZE / 2
  const align = colName === 'left' ? 'left' : colName === 'right' ? 'right' : 'center'
  return { anchorX: Math.round(x), anchorY: Math.round(y), align }
}

function drawTextWithShadow(ctx, text, x, y) {
  ctx.save()
  ctx.shadowColor = 'rgba(0,0,0,0.65)'
  ctx.shadowBlur = 6
  ctx.shadowOffsetX = 0
  ctx.shadowOffsetY = 2
  ctx.fillText(text, x, y)
  ctx.restore()
}

function drawFreeformBlock(ctx, block, brandStyle) {
  const role = BLOCK_ROLES.includes(block.role) ? block.role : 'body'
  const typo = roleTypography(role, brandStyle)
  const raw = (block.text || '').trim()
  if (!raw) return
  const display = typo.uppercase ? raw.toUpperCase() : raw
  const { anchorX, anchorY, align } = resolvePosition(block.position)

  ctx.font = typo.font
  ctx.fillStyle = typo.color
  ctx.textBaseline = 'alphabetic'
  ctx.textAlign = align === 'left' ? 'left' : align === 'right' ? 'right' : 'center'

  if (typo.pill) {
    // CTA pill — different layout: rounded background + centered text
    const accent = brandAccent(brandStyle)
    const textW = ctx.measureText(display).width
    const pillW = Math.min(textW + 80, Math.round(SIZE * typo.maxWidthFrac))
    const pillH = 80
    let pillX
    if (align === 'left')       pillX = anchorX
    else if (align === 'right') pillX = anchorX - pillW
    else                        pillX = anchorX - pillW / 2
    const pillY = anchorY - pillH
    ctx.fillStyle = accent
    drawRoundedRect(ctx, pillX, pillY, pillW, pillH, pillH / 2)
    ctx.fill()
    ctx.fillStyle = 'white'
    ctx.textBaseline = 'middle'
    ctx.textAlign = 'center'
    ctx.fillText(display, pillX + pillW / 2, pillY + pillH / 2)
    return
  }

  const maxW = Math.round(SIZE * typo.maxWidthFrac)
  const lines = wrapLines(ctx, display, maxW, typo.maxLines)
  // Block grows UP from anchorY (bottom-aligned) so positioning feels natural —
  // "bottom" preset means the LAST line sits at the bottom safe-area.
  let y = anchorY - (lines.length - 1) * typo.lineH
  for (const l of lines) {
    if (typo.shadow) drawTextWithShadow(ctx, l, anchorX, y)
    else             ctx.fillText(l, anchorX, y)
    y += typo.lineH
  }
  ctx.textAlign = 'start'
}

// Per-slide template chip → default block set for AI generation. The renderer
// doesn't consume this; it's metadata for prompt + UI defaults. Editor users
// can switch templates to swap the AI's default block pattern.
export const SLIDE_TEMPLATES = {
  cover:         { label: 'Cover',         default_blocks: ['hook', 'page'] },
  explainer:     { label: 'Explainer',     default_blocks: ['hook', 'body', 'caption'] },
  demonstration: { label: 'Demonstration', default_blocks: [] },
  quote:         { label: 'Quote',         default_blocks: ['body', 'attribution'] },
  cta:           { label: 'CTA',           default_blocks: ['hook', 'body', 'cta'] },
  custom:        { label: 'Custom',        default_blocks: [] },
}

export const TEMPLATE_DEFAULT_POSITIONS = {
  cover:         { hook: 'center',      page: 'bottom-right' },
  explainer:     { hook: 'top',         body: 'center',       caption: 'bottom' },
  demonstration: {},
  quote:         { body: 'center',      attribution: 'bottom-right' },
  cta:           { hook: 'top',         body: 'center',       cta: 'bottom' },
  custom:        {},
}

// Render one slide (photo + freeform text blocks) to a canvas. Returns the
// canvas so callers can either display it directly (DOM canvas preview) or
// call toBlob() to produce a baked PNG.
export async function renderFreeformSlide({ sourceUrl, slide, brandStyle, canvas }) {
  const target = canvas || document.createElement('canvas')
  target.width  = SIZE
  target.height = SIZE
  const ctx = target.getContext('2d')

  if (sourceUrl) {
    const img = await loadImage(sourceUrl)
    drawCover(ctx, img, 0, 0, SIZE, SIZE)
  } else {
    // No photo bound — render a neutral placeholder so text is still legible
    const grad = ctx.createLinearGradient(0, 0, 0, SIZE)
    grad.addColorStop(0, '#475569')
    grad.addColorStop(1, '#1e293b')
    ctx.fillStyle = grad
    ctx.fillRect(0, 0, SIZE, SIZE)
  }

  // Light vignette so any-position text stays legible regardless of photo
  const blocks = Array.isArray(slide?.blocks) ? slide.blocks : []
  if (blocks.length > 0) {
    const vignette = ctx.createRadialGradient(SIZE / 2, SIZE / 2, SIZE * 0.35, SIZE / 2, SIZE / 2, SIZE * 0.75)
    vignette.addColorStop(0, 'rgba(0,0,0,0)')
    vignette.addColorStop(1, 'rgba(0,0,0,0.45)')
    ctx.fillStyle = vignette
    ctx.fillRect(0, 0, SIZE, SIZE)
  }

  for (const block of blocks) {
    drawFreeformBlock(ctx, block, brandStyle || {})
  }

  return target
}

// ── Public API ──────────────────────────────────────────────────────────────

export async function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new window.Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = reject
    img.src = url
  })
}

// Render one slide and return a PNG blob. Used by ReviewPost compose flows.
//   spec = { template, emphasis?, colorChoice?, photoDim?, text }
//   text  = string (solo) or { hook, subhead, cta } (combined)
export async function renderSlide({ sourceUrl, spec, brandStyle }) {
  const tmpl = TEMPLATES[spec.template]
  if (!tmpl) throw new Error(`Unknown template: ${spec.template}`)

  const canvas = document.createElement('canvas')
  canvas.width  = SIZE
  canvas.height = SIZE
  const ctx = canvas.getContext('2d')

  const img = await loadImage(sourceUrl)
  tmpl.render(ctx, {
    img,
    text: spec.text,
    brandStyle: brandStyle || {},
    options: {
      emphasis:    spec.emphasis,
      colorChoice: spec.colorChoice,
      photoDim:    spec.photoDim,
    },
  })

  return await new Promise((res, rej) =>
    canvas.toBlob((b) => (b ? res(b) : rej(new Error('Canvas export failed'))), 'image/png', 0.92)
  )
}
