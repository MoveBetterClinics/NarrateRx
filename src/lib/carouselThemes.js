// Carousel theme system.
//
// A theme is a map of block roles → style config. Built-in themes ship in
// code so every workspace has them with no DB setup. Custom themes are stored
// in workspace_carousel_themes and fetched from GET /api/carousel-themes.
//
// Config shape per block role:
//   fontSize:   'xs'|'sm'|'base'|'lg'|'xl'|'2xl'|'3xl'
//   fontWeight: 'normal'|'medium'|'semibold'|'bold'|'extrabold'
//   color:      CSS color string
//   shadow:     'none'|'soft'|'medium'|'strong'
//   background: 'none'|'pill'|'rect'
//   bgColor:    CSS color string | null  (null = use brand accent for pill)
//   uppercase:  boolean

// Maps named sizes to canvas px on a 1080×1080 canvas.
export const FONT_SIZE_PX = {
  xs:    28,
  sm:    36,
  base:  44,
  lg:    56,
  xl:    72,
  '2xl': 84,
  '3xl': 100,
}

// Maps named weights to CSS/canvas weight strings.
export const FONT_WEIGHT_CSS = {
  normal:    '400',
  medium:    '500',
  semibold:  '600',
  bold:      '700',
  extrabold: '800',
}

// Defaults used when a theme omits a block role entirely.
const FALLBACK_BLOCK = {
  fontSize: 'base', fontWeight: 'semibold', color: '#ffffff',
  shadow: 'medium', background: 'none', bgColor: null, uppercase: false,
}

// ── Built-in themes ─────────────────────────────────────────────────────────

export const BUILTIN_THEMES = {
  'bold-dark': {
    id: 'bold-dark',
    name: 'Bold Dark',
    builtin: true,
    blocks: {
      hook:        { fontSize: '2xl',  fontWeight: 'extrabold', color: '#ffffff',              shadow: 'medium', background: 'none', bgColor: null,                    uppercase: true  },
      body:        { fontSize: 'base', fontWeight: 'semibold',  color: '#ffffff',              shadow: 'medium', background: 'none', bgColor: null,                    uppercase: false },
      caption:     { fontSize: 'sm',   fontWeight: 'medium',    color: 'rgba(255,255,255,0.92)', shadow: 'medium', background: 'none', bgColor: null,                  uppercase: false },
      cta:         { fontSize: 'base', fontWeight: 'bold',      color: '#ffffff',              shadow: 'none',   background: 'pill', bgColor: null,                    uppercase: false },
      attribution: { fontSize: 'xs',   fontWeight: 'medium',    color: 'rgba(255,255,255,0.9)',  shadow: 'soft',   background: 'none', bgColor: null,                  uppercase: false },
      page:        { fontSize: 'xs',   fontWeight: 'semibold',  color: 'rgba(255,255,255,0.85)', shadow: 'soft',   background: 'none', bgColor: null,                  uppercase: false },
    },
  },

  'warm-light': {
    id: 'warm-light',
    name: 'Warm Light',
    builtin: true,
    blocks: {
      hook:        { fontSize: 'xl',   fontWeight: 'bold',      color: '#1c1917',              shadow: 'none',   background: 'rect', bgColor: 'rgba(255,251,235,0.92)', uppercase: false },
      body:        { fontSize: 'base', fontWeight: 'medium',    color: '#44403c',              shadow: 'none',   background: 'rect', bgColor: 'rgba(255,251,235,0.85)', uppercase: false },
      caption:     { fontSize: 'sm',   fontWeight: 'medium',    color: '#57534e',              shadow: 'none',   background: 'rect', bgColor: 'rgba(255,251,235,0.80)', uppercase: false },
      cta:         { fontSize: 'base', fontWeight: 'bold',      color: '#9a3412',              shadow: 'none',   background: 'pill', bgColor: 'rgba(254,215,170,0.95)', uppercase: false },
      attribution: { fontSize: 'xs',   fontWeight: 'medium',    color: '#ffffff',              shadow: 'soft',   background: 'none', bgColor: null,                    uppercase: false },
      page:        { fontSize: 'xs',   fontWeight: 'semibold',  color: 'rgba(255,255,255,0.85)', shadow: 'soft',  background: 'none', bgColor: null,                   uppercase: false },
    },
  },

  'brand': {
    id: 'brand',
    name: 'Brand',
    builtin: true,
    blocks: {
      hook:        { fontSize: '2xl',  fontWeight: 'extrabold', color: '#ffffff',              shadow: 'medium', background: 'none', bgColor: null,                    uppercase: false },
      body:        { fontSize: 'base', fontWeight: 'medium',    color: 'rgba(255,255,255,0.9)',  shadow: 'medium', background: 'none', bgColor: null,                  uppercase: false },
      caption:     { fontSize: 'sm',   fontWeight: 'medium',    color: 'rgba(255,255,255,0.88)', shadow: 'medium', background: 'none', bgColor: null,                  uppercase: false },
      cta:         { fontSize: 'base', fontWeight: 'bold',      color: '#ffffff',              shadow: 'none',   background: 'rect', bgColor: null,                    uppercase: false },
      attribution: { fontSize: 'xs',   fontWeight: 'medium',    color: 'rgba(255,255,255,0.9)',  shadow: 'soft',   background: 'none', bgColor: null,                  uppercase: false },
      page:        { fontSize: 'xs',   fontWeight: 'semibold',  color: 'rgba(255,255,255,0.85)', shadow: 'soft',   background: 'none', bgColor: null,                  uppercase: false },
    },
  },

  'minimal': {
    id: 'minimal',
    name: 'Minimal',
    builtin: true,
    blocks: {
      hook:        { fontSize: 'xl',   fontWeight: 'semibold',  color: '#ffffff',              shadow: 'soft',   background: 'none', bgColor: null,                    uppercase: false },
      body:        { fontSize: 'sm',   fontWeight: 'normal',    color: 'rgba(255,255,255,0.75)', shadow: 'soft',  background: 'none', bgColor: null,                   uppercase: false },
      caption:     { fontSize: 'sm',   fontWeight: 'normal',    color: 'rgba(255,255,255,0.65)', shadow: 'soft',  background: 'none', bgColor: null,                   uppercase: false },
      cta:         { fontSize: 'sm',   fontWeight: 'semibold',  color: '#ffffff',              shadow: 'none',   background: 'pill', bgColor: 'rgba(255,255,255,0.18)', uppercase: false },
      attribution: { fontSize: 'xs',   fontWeight: 'normal',    color: 'rgba(255,255,255,0.6)',  shadow: 'none',   background: 'none', bgColor: null,                  uppercase: false },
      page:        { fontSize: 'xs',   fontWeight: 'medium',    color: 'rgba(255,255,255,0.55)', shadow: 'none',   background: 'none', bgColor: null,                  uppercase: false },
    },
  },

  'high-contrast': {
    id: 'high-contrast',
    name: 'High Contrast',
    builtin: true,
    blocks: {
      hook:        { fontSize: 'xl',   fontWeight: 'extrabold', color: '#000000',              shadow: 'none',   background: 'rect', bgColor: '#ffffff',                uppercase: false },
      body:        { fontSize: 'base', fontWeight: 'bold',      color: '#000000',              shadow: 'none',   background: 'rect', bgColor: 'rgba(255,255,255,0.92)', uppercase: false },
      caption:     { fontSize: 'sm',   fontWeight: 'semibold',  color: '#000000',              shadow: 'none',   background: 'rect', bgColor: 'rgba(255,255,255,0.88)', uppercase: false },
      cta:         { fontSize: 'base', fontWeight: 'extrabold', color: '#ffffff',              shadow: 'none',   background: 'rect', bgColor: '#000000',                uppercase: true  },
      attribution: { fontSize: 'xs',   fontWeight: 'bold',      color: '#000000',              shadow: 'none',   background: 'rect', bgColor: 'rgba(255,255,255,0.88)', uppercase: false },
      page:        { fontSize: 'xs',   fontWeight: 'bold',      color: '#000000',              shadow: 'none',   background: 'rect', bgColor: '#ffffff',                uppercase: false },
    },
  },
}

export const BUILTIN_THEME_IDS = Object.keys(BUILTIN_THEMES)

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Resolve a theme ID (built-in slug or custom UUID) to a theme object.
 *  Falls back to bold-dark if nothing matches. */
export function resolveTheme(themeId, customThemes = []) {
  if (!themeId) return BUILTIN_THEMES['bold-dark']
  if (BUILTIN_THEMES[themeId]) return BUILTIN_THEMES[themeId]
  const custom = customThemes.find((t) => t.id === themeId)
  if (custom) return custom
  return BUILTIN_THEMES['bold-dark']
}

/** Return the style config for a specific role within a resolved theme. */
export function themeBlockConfig(theme, role) {
  return theme?.blocks?.[role] || BUILTIN_THEMES['bold-dark'].blocks[role] || FALLBACK_BLOCK
}

/** Default block config used in the settings editor form when creating a new theme. */
export function defaultBlockConfig(role) {
  return BUILTIN_THEMES['bold-dark'].blocks[role] || FALLBACK_BLOCK
}

/** All themes in display order: built-ins first, then custom. */
export function mergeThemes(customThemes = []) {
  return [...Object.values(BUILTIN_THEMES), ...customThemes]
}
