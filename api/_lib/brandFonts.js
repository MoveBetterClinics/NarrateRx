// Brand font resolver for the render pipeline.
//
// Resolves the workspace's preferred font (from brand_style.heading_font /
// body_font) → returns a TTF Buffer that brandRender embeds in the SVG via
// `@font-face` data-URI. This makes the SVG self-contained, so librsvg
// (Sharp's SVG renderer) can rasterise text correctly in any environment —
// no fontconfig, no system font dependency, no tofu/garbled glyphs.
//
// Resolution order:
//   1. workspace.brand_style.heading_font in Google Fonts → fetch + cache
//   2. workspace.brand_style.body_font in Google Fonts → fetch + cache
//   3. Bundled Inter-Bold.ttf fallback (always works)
//
// Caching: module-level Map keyed by font family name, persists across
// invocations within the same warm Vercel function instance. Cold starts
// re-fetch (one ~50ms hit then cached for the container's lifetime).

import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const FALLBACK_FONT_PATH = join(__dirname, 'fonts', 'Inter-Bold.ttf')

// In-memory font cache: family name → TTF Buffer
const FONT_CACHE = new Map()

// Bundled fallback — loaded once on cold start
let fallbackFontPromise = null

function loadFallbackFont() {
  if (!fallbackFontPromise) {
    fallbackFontPromise = readFile(FALLBACK_FONT_PATH)
  }
  return fallbackFontPromise
}

/**
 * Fetch a font's TTF from Google Fonts.
 * Uses the CSS API with a non-browser User-Agent so Google returns TTF URLs
 * (instead of woff2, which librsvg sometimes struggles with).
 */
async function fetchGoogleFontTtf(family, weight = 700) {
  const familyParam = family.trim().replace(/\s+/g, '+')
  const cssUrl = `https://fonts.googleapis.com/css2?family=${familyParam}:wght@${weight}&display=swap`

  const cssRes = await fetch(cssUrl, {
    headers: { 'User-Agent': 'Wget/1.21' },  // forces TTF response
    signal: AbortSignal.timeout(5000),
  })
  if (!cssRes.ok) {
    throw new Error(`Font CSS fetch ${cssRes.status} for "${family}"`)
  }
  const css = await cssRes.text()

  // Extract the first ttf URL from `src: url(...) format('truetype')`
  const match = css.match(/url\((https:\/\/fonts\.gstatic\.com\/[^)]+\.ttf)\)/)
  if (!match) {
    throw new Error(`No TTF URL found in Google Fonts CSS for "${family}"`)
  }

  const ttfRes = await fetch(match[1], { signal: AbortSignal.timeout(8000) })
  if (!ttfRes.ok) {
    throw new Error(`Font TTF fetch ${ttfRes.status} for "${family}"`)
  }
  const buffer = Buffer.from(await ttfRes.arrayBuffer())

  // Sanity check: TTF files are at least a few KB. Anything smaller is suspect.
  if (buffer.length < 1024) {
    throw new Error(`Font for "${family}" is suspiciously small: ${buffer.length} bytes`)
  }
  return buffer
}

/**
 * Resolve the brand font for a workspace and return its TTF as a Buffer.
 *
 * @param {Object} workspace — workspace row (reads brand_style.heading_font / body_font)
 * @returns {Promise<{ buffer: Buffer, family: string, source: 'google'|'fallback' }>}
 */
export async function getBrandFont(workspace) {
  const requested = workspace?.brand_style?.heading_font
    || workspace?.brand_style?.body_font
    || null

  if (requested) {
    // Cached?
    if (FONT_CACHE.has(requested)) {
      return { buffer: FONT_CACHE.get(requested), family: requested, source: 'google' }
    }

    // Try Google Fonts
    try {
      const buffer = await fetchGoogleFontTtf(requested, 700)
      FONT_CACHE.set(requested, buffer)
      return { buffer, family: requested, source: 'google' }
    } catch (e) {
      console.warn(`[brandFonts] Google Fonts failed for "${requested}": ${e.message}. Falling back to Inter.`)
      // fall through to fallback
    }
  }

  // Bundled fallback
  const buffer = await loadFallbackFont()
  return { buffer, family: 'Inter', source: 'fallback' }
}
