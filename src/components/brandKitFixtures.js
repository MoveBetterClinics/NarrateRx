// Fixture data for the Brand Kit mockup. Represents a typical designer
// hand-off: ~12 logo variants in different shapes / backgrounds / color modes,
// plus a brand book PDF and a couple social-specific exports. Each asset
// carries the same metadata shape the real `brand_assets` table will: shape,
// background, color_mode, filename_tokens, and a server-computed
// ai_classification with ranked role candidates.

// A tiny SVG generator so each tile in the mockup actually looks like a
// distinct logo variant — much easier to read the UX than colored rectangles.
// Renders an "MB" mark + optional "Move Better" wordmark, sized to the shape.
function logoSvg({ shape, background, colorMode, kind }) {
  const bgFill =
    background === 'dark'        ? '#0f172a' :
    background === 'transparent' ? 'transparent' :
                                   '#ffffff'
  const fg =
    colorMode === 'mono_white' ? '#ffffff' :
    colorMode === 'mono_black' ? '#0f172a' :
                                 '#0a7f3f'   // brand accent (color mode)
  const accent = colorMode === 'color' ? '#1e40af' : fg

  const showWordmark = kind === 'wordmark' || kind === 'logo'
  const showMark     = kind === 'mark'     || kind === 'logo'

  let vb = '0 0 200 80', mark = '', word = ''
  if (shape === 'icon' || shape === 'square') {
    vb = '0 0 80 80'
    mark = showMark ? `<rect x="14" y="14" width="22" height="52" rx="3" fill="${fg}"/><rect x="44" y="14" width="22" height="52" rx="3" fill="${accent}"/>` : ''
    word = ''
  } else if (shape === 'vertical') {
    vb = '0 0 120 160'
    mark = showMark ? `<rect x="30" y="20" width="22" height="50" rx="3" fill="${fg}"/><rect x="60" y="20" width="22" height="50" rx="3" fill="${accent}"/>` : ''
    word = showWordmark ? `<text x="60" y="110" font-family="Inter,system-ui,sans-serif" font-size="18" font-weight="700" fill="${fg}" text-anchor="middle">Move</text><text x="60" y="132" font-family="Inter,system-ui,sans-serif" font-size="18" font-weight="700" fill="${fg}" text-anchor="middle">Better</text>` : ''
  } else { // horizontal
    mark = showMark ? `<rect x="14" y="20" width="16" height="40" rx="2" fill="${fg}"/><rect x="34" y="20" width="16" height="40" rx="2" fill="${accent}"/>` : ''
    word = showWordmark ? `<text x="${showMark ? 64 : 14}" y="50" font-family="Inter,system-ui,sans-serif" font-size="26" font-weight="700" fill="${fg}">Move Better</text>` : ''
  }

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}" preserveAspectRatio="xMidYMid meet">${bgFill !== 'transparent' ? `<rect width="100%" height="100%" fill="${bgFill}"/>` : ''}${mark}${word}</svg>`
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`
}

// Helper to score role candidates from the asset metadata. Kept here in the
// fixtures file because the same heuristic will live server-side at upload
// time on the real path — this lets the mockup behave like the real thing.
function scoreCandidates(a) {
  const out = []
  const tok = a.filename_tokens || []
  const isHoriz = a.shape === 'horizontal'
  const isIcon  = a.shape === 'icon' || (a.shape === 'square' && (a.width || 256) <= 128)
  const onLight = a.background === 'light'
  const onDark  = a.background === 'dark'
  const color   = a.color_mode === 'color'
  const monoW   = a.color_mode === 'mono_white'

  if (a.mime_type === 'application/pdf') {
    out.push({ role: 'brand_book', confidence: 0.95 })
    return out
  }

  if (isHoriz && onLight && color && tok.includes('primary')) out.push({ role: 'primary_logo', confidence: 0.92 })
  else if (isHoriz && onLight && color)                       out.push({ role: 'primary_logo', confidence: 0.74 })

  if (isIcon)                                                 out.push({ role: 'mark_only', confidence: 0.82 })
  if (isIcon && (a.width || 256) <= 64)                       out.push({ role: 'favicon',   confidence: 0.88 })

  if (tok.includes('wordmark') && !isIcon)                    out.push({ role: 'wordmark_only', confidence: 0.85 })

  if (monoW || onDark)                                        out.push({ role: 'logo_on_dark', confidence: 0.83 })
  else if (onLight && a.color_mode === 'mono_black')          out.push({ role: 'logo_on_light', confidence: 0.78 })

  if (a.shape === 'square' && (a.width || 0) >= 400 && tok.some(t => ['social','avatar','profile'].includes(t)))
                                                              out.push({ role: 'social_avatar', confidence: 0.86 })
  if (tok.some(t => ['cover','banner','header'].includes(t)) && (a.width || 0) >= 1200)
                                                              out.push({ role: 'social_cover', confidence: 0.84 })

  return out.sort((a, b) => b.confidence - a.confidence).slice(0, 3)
}

const rawAssets = [
  // The designer's classic primary — horizontal, full color, named "primary".
  { id: 'a1',  filename: 'movebetter-logo-primary-horizontal-rgb.svg',     mime_type: 'image/svg+xml', byte_size: 18_400,
    width: 1200, height: 480, shape: 'horizontal', background: 'light', color_mode: 'color',      has_alpha: true,
    filename_tokens: ['movebetter','logo','primary','horizontal','rgb'],
    _logo: { shape: 'horizontal', background: 'light',  colorMode: 'color',      kind: 'logo' } },

  { id: 'a2',  filename: 'movebetter-logo-horizontal-mono-black.svg',      mime_type: 'image/svg+xml', byte_size: 12_100,
    width: 1200, height: 480, shape: 'horizontal', background: 'light', color_mode: 'mono_black', has_alpha: true,
    filename_tokens: ['movebetter','logo','horizontal','mono','black'],
    _logo: { shape: 'horizontal', background: 'light',  colorMode: 'mono_black', kind: 'logo' } },

  { id: 'a3',  filename: 'movebetter-logo-horizontal-reversed-on-dark.png',mime_type: 'image/png',     byte_size: 64_300,
    width: 2400, height: 960, shape: 'horizontal', background: 'dark', color_mode: 'mono_white',  has_alpha: false,
    filename_tokens: ['movebetter','logo','horizontal','reversed','on-dark'],
    _logo: { shape: 'horizontal', background: 'dark',   colorMode: 'mono_white', kind: 'logo' } },

  { id: 'a4',  filename: 'movebetter-logo-vertical-rgb.svg',               mime_type: 'image/svg+xml', byte_size: 19_000,
    width: 600,  height: 800, shape: 'vertical',   background: 'light', color_mode: 'color',      has_alpha: true,
    filename_tokens: ['movebetter','logo','vertical','rgb'],
    _logo: { shape: 'vertical',   background: 'light',  colorMode: 'color',      kind: 'logo' } },

  { id: 'a5',  filename: 'movebetter-logo-square-rgb.png',                 mime_type: 'image/png',     byte_size: 92_000,
    width: 1024, height: 1024, shape: 'square',    background: 'light', color_mode: 'color',      has_alpha: true,
    filename_tokens: ['movebetter','logo','square','rgb'],
    _logo: { shape: 'square',     background: 'light',  colorMode: 'color',      kind: 'logo' } },

  { id: 'a6',  filename: 'movebetter-mark-only-rgb.svg',                   mime_type: 'image/svg+xml', byte_size: 8_900,
    width: 512,  height: 512, shape: 'icon',       background: 'transparent', color_mode: 'color', has_alpha: true,
    filename_tokens: ['movebetter','mark','only','rgb'],
    _logo: { shape: 'icon',       background: 'transparent', colorMode: 'color', kind: 'mark' } },

  { id: 'a7',  filename: 'movebetter-mark-only-black.svg',                 mime_type: 'image/svg+xml', byte_size: 7_400,
    width: 512,  height: 512, shape: 'icon',       background: 'transparent', color_mode: 'mono_black', has_alpha: true,
    filename_tokens: ['movebetter','mark','only','black'],
    _logo: { shape: 'icon',       background: 'transparent', colorMode: 'mono_black', kind: 'mark' } },

  { id: 'a8',  filename: 'movebetter-mark-only-white.svg',                 mime_type: 'image/svg+xml', byte_size: 7_500,
    width: 512,  height: 512, shape: 'icon',       background: 'transparent', color_mode: 'mono_white', has_alpha: true,
    filename_tokens: ['movebetter','mark','only','white'],
    _logo: { shape: 'icon',       background: 'dark',        colorMode: 'mono_white', kind: 'mark' } },

  { id: 'a9',  filename: 'movebetter-favicon-32.png',                      mime_type: 'image/png',     byte_size: 1_200,
    width: 32,   height: 32, shape: 'icon',        background: 'transparent', color_mode: 'color', has_alpha: true,
    filename_tokens: ['movebetter','favicon','32'],
    _logo: { shape: 'icon',       background: 'transparent', colorMode: 'color', kind: 'mark' } },

  { id: 'a10', filename: 'movebetter-wordmark-black.svg',                  mime_type: 'image/svg+xml', byte_size: 5_600,
    width: 1400, height: 280, shape: 'horizontal', background: 'transparent', color_mode: 'mono_black', has_alpha: true,
    filename_tokens: ['movebetter','wordmark','black'],
    _logo: { shape: 'horizontal', background: 'light',  colorMode: 'mono_black', kind: 'wordmark' } },

  { id: 'a11', filename: 'social-avatar-1024.png',                         mime_type: 'image/png',     byte_size: 88_000,
    width: 1024, height: 1024, shape: 'square',    background: 'light', color_mode: 'color',      has_alpha: false,
    filename_tokens: ['social','avatar','1024'],
    _logo: { shape: 'square',     background: 'light',  colorMode: 'color',      kind: 'mark' } },

  { id: 'a12', filename: 'social-cover-1500x500.png',                      mime_type: 'image/png',     byte_size: 240_000,
    width: 1500, height: 500, shape: 'horizontal', background: 'light', color_mode: 'color',      has_alpha: false,
    filename_tokens: ['social','cover','1500x500'],
    _logo: { shape: 'horizontal', background: 'light',  colorMode: 'color',      kind: 'logo' } },

  { id: 'a13', filename: 'movebetter-brand-book-v3.pdf',                   mime_type: 'application/pdf', byte_size: 4_800_000,
    width: null, height: null, shape: null,        background: null,    color_mode: null,         has_alpha: null,
    filename_tokens: ['movebetter','brand','book','v3'] },
]

export const FIXTURE_ASSETS = rawAssets.map((a) => ({
  ...a,
  uploaded_at: '2026-05-12T14:00:00Z',
  blob_url: a.mime_type === 'application/pdf' ? null : logoSvg(a._logo),
  ai_classification: { role_candidates: scoreCandidates(a) },
}))

export const ROLE_DEFS = [
  { id: 'primary_logo',  label: 'Primary logo',       hint: 'Default mark across email headers, web nav, social posts.' },
  { id: 'mark_only',     label: 'Mark only',          hint: 'Icon/glyph without the wordmark — small-space use.' },
  { id: 'wordmark_only', label: 'Wordmark only',      hint: 'Text-only variant when the mark would crowd the layout.' },
  { id: 'logo_on_light', label: 'Logo for light bg',  hint: 'Canonical version when placed on a light surface.' },
  { id: 'logo_on_dark',  label: 'Logo for dark bg',   hint: 'Reversed-out variant for dark surfaces.' },
  { id: 'favicon',       label: 'Favicon',            hint: '32×32 export used by the browser tab icon.' },
  { id: 'social_avatar', label: 'Social avatar',      hint: 'Square profile image for Buffer / IG / FB.' },
  { id: 'social_cover',  label: 'Social cover',       hint: '1500×500-ish banner for profile headers.' },
  { id: 'brand_book',    label: 'Brand book',         hint: 'Reference PDF — stored for humans, not rendered.' },
]

export const FIXTURE_STYLE = {
  accent_color: '#0a7f3f',
  secondary_colors: ['#1e40af', '#f59e0b'],
  heading_font: 'Inter',
  body_font: 'Source Sans 3',
}
