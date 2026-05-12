// Brand Kit classifier — pure functions that turn an uploaded brand asset into
// the shape/background/color_mode/filename_tokens/ai_classification fields
// stored on the brand_assets row. Called from the upload endpoint after the
// file lands in Blob.
//
// Image analysis uses sharp (already a transitive dep via thumbnail.js). For
// PDFs and other non-image types only the filename-token + role scoring path
// runs; shape/background/color_mode stay null.
//
// Keep this pure (no DB writes, no fetch) so it can be unit-tested without a
// running Supabase. The caller is responsible for persisting the result.

const KNOWN_TOKENS = new Set([
  'primary','secondary','horizontal','vertical','square','icon','mark','wordmark',
  'logo','symbol','glyph','emblem',
  'light','dark','reversed','knockout','onlight','ondark','on-light','on-dark',
  'white','black','color','colour','mono','monochrome',
  'favicon','social','avatar','profile','cover','banner','header',
  'rgb','cmyk','spot','transparent','flat',
  'brand','book','guide','guidelines','style',
])

export function parseFilenameTokens(filename) {
  if (!filename) return []
  const base = filename.toLowerCase().replace(/\.[^.]+$/, '')
  const parts = base.split(/[\s_\-.]+/).filter(Boolean)
  // Dedupe but preserve first-seen order so callers can read the filename's
  // intent left-to-right ("primary-horizontal-rgb").
  const seen = new Set()
  const out = []
  for (const p of parts) {
    if (!KNOWN_TOKENS.has(p) || seen.has(p)) continue
    seen.add(p)
    out.push(p)
  }
  return out
}

export function shapeFromDimensions(width, height) {
  if (!width || !height) return null
  const ratio = width / height
  // Icon ≡ small square. The 128px cutoff is the practical boundary between
  // "favicon export" and "square logo for social avatar use" in typical brand
  // hand-offs — designers don't ship 96px social avatars.
  const isSquareish = ratio > 0.9 && ratio < 1.1
  if (isSquareish && Math.max(width, height) <= 128) return 'icon'
  if (isSquareish) return 'square'
  if (ratio >= 1.8) return 'horizontal'
  if (ratio <= 0.55) return 'vertical'
  // Between vertical and horizontal — bucket toward whichever side dominates.
  return ratio > 1 ? 'horizontal' : 'vertical'
}

// Inferred background from corner luminance + alpha. Caller passes the four
// corner-region stats from sharp.extract() → .stats() (or computes mean RGBA
// some other way and packages it as { r, g, b, a } per corner).
export function backgroundFromCorners(corners, hasAlpha) {
  if (!corners || corners.length === 0) return 'unknown'
  // If most corners are transparent, the asset has a real cut-out background.
  if (hasAlpha) {
    const transparentCorners = corners.filter((c) => (c.a ?? 255) < 32).length
    if (transparentCorners >= 3) return 'transparent'
  }
  // Otherwise classify by average luminance of corner regions. ITU-R BT.601.
  const lums = corners.map((c) => 0.299 * c.r + 0.587 * c.g + 0.114 * c.b)
  const avg = lums.reduce((s, x) => s + x, 0) / lums.length
  if (avg >= 200) return 'light'
  if (avg <= 60)  return 'dark'
  return 'unknown'  // mid-tone background — don't guess
}

// Inferred color mode from a coarse dominant-color analysis. Caller passes
// the full-image mean { r, g, b } and saturation indicator from sharp.stats().
export function colorModeFromStats(mean, saturation) {
  if (!mean) return 'unknown'
  // Saturation near 0 → monochrome. sharp's stats doesn't return HSV directly,
  // so we approximate via the spread between channels.
  const spread = Math.max(mean.r, mean.g, mean.b) - Math.min(mean.r, mean.g, mean.b)
  const isMono = (saturation != null ? saturation < 0.05 : spread < 12)
  if (!isMono) return 'color'
  const luminance = 0.299 * mean.r + 0.587 * mean.g + 0.114 * mean.b
  if (luminance >= 180) return 'mono_white'
  return 'mono_black'
}

// Combine the inferred attributes + filename tokens into ranked role
// candidates. Same heuristic the fixtures file uses on the client mockup —
// kept in sync so the UX preview accurately models the real classifier.
export function scoreRoleCandidates(asset) {
  const out = []
  const tok = asset.filename_tokens || []
  const isHoriz = asset.shape === 'horizontal'
  const isIcon  = asset.shape === 'icon' || (asset.shape === 'square' && (asset.width || 256) <= 128)
  const onLight = asset.background === 'light'
  const onDark  = asset.background === 'dark'
  const color   = asset.color_mode === 'color'
  const monoW   = asset.color_mode === 'mono_white'
  const monoB   = asset.color_mode === 'mono_black'

  if (asset.mime_type === 'application/pdf') {
    out.push({ role: 'brand_book', confidence: 0.95 })
    return out
  }

  if (isHoriz && onLight && color && tok.includes('primary')) out.push({ role: 'primary_logo', confidence: 0.92 })
  else if (isHoriz && onLight && color)                       out.push({ role: 'primary_logo', confidence: 0.74 })

  if (isIcon)                                                 out.push({ role: 'mark_only', confidence: 0.82 })
  if (isIcon && (asset.width || 256) <= 64)                   out.push({ role: 'favicon',   confidence: 0.88 })

  if (tok.includes('wordmark') && !isIcon)                    out.push({ role: 'wordmark_only', confidence: 0.85 })

  if (monoW || onDark)                                        out.push({ role: 'logo_on_dark', confidence: 0.83 })
  else if (onLight && monoB)                                  out.push({ role: 'logo_on_light', confidence: 0.78 })

  if (asset.shape === 'square' && (asset.width || 0) >= 400 &&
      tok.some((t) => ['social','avatar','profile'].includes(t)))
                                                              out.push({ role: 'social_avatar', confidence: 0.86 })
  if (tok.some((t) => ['cover','banner','header'].includes(t)) && (asset.width || 0) >= 1200)
                                                              out.push({ role: 'social_cover', confidence: 0.84 })

  return out.sort((a, b) => b.confidence - a.confidence).slice(0, 3)
}

// Run sharp metadata + stats on a buffer and return the inferred fields.
// Skips for PDFs / unsupported types — caller falls back to filename-only.
export async function inferImageAttributes(buffer, mimeType) {
  if (!buffer || !mimeType || !mimeType.startsWith('image/')) {
    return { width: null, height: null, has_alpha: null, shape: null, background: 'unknown', color_mode: 'unknown' }
  }
  // Lazy-import sharp so this module is safe to import on edge bundles that
  // don't carry sharp (e.g. unit tests of the pure scoring fns).
  const { default: sharp } = await import('sharp')
  const img = sharp(buffer, { failOn: 'none' })
  const meta = await img.metadata()
  const width = meta.width || null
  const height = meta.height || null
  const has_alpha = !!meta.hasAlpha

  // Whole-image stats for color-mode inference.
  let mean = null, saturation = null
  try {
    const stats = await img.stats()
    if (stats?.channels?.length >= 3) {
      mean = { r: stats.channels[0].mean, g: stats.channels[1].mean, b: stats.channels[2].mean }
    }
    saturation = typeof stats?.isOpaque === 'boolean' ? null : null  // sharp doesn't expose saturation; fall back to spread heuristic
  } catch { /* empty */ }

  // Corner samples for background inference. Take 12% of the smaller side as
  // the sample square; large enough to dodge JPEG noise but small enough to
  // not bleed into the logo itself.
  const corners = []
  if (width && height) {
    const s = Math.max(8, Math.floor(Math.min(width, height) * 0.12))
    const positions = [
      { left: 0, top: 0 },
      { left: width - s, top: 0 },
      { left: 0, top: height - s },
      { left: width - s, top: height - s },
    ]
    for (const p of positions) {
      try {
        const region = await sharp(buffer, { failOn: 'none' })
          .extract({ left: p.left, top: p.top, width: s, height: s })
          .stats()
        if (region?.channels?.length >= 3) {
          corners.push({
            r: region.channels[0].mean,
            g: region.channels[1].mean,
            b: region.channels[2].mean,
            a: region.channels[3]?.mean ?? 255,
          })
        }
      } catch { /* corner extract failed — skip this position */ }
    }
  }

  return {
    width,
    height,
    has_alpha,
    shape: shapeFromDimensions(width, height),
    background: backgroundFromCorners(corners, has_alpha),
    color_mode: colorModeFromStats(mean, saturation),
  }
}
