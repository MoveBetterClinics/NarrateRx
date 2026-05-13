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
