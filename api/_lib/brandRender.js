// Brand-styled photo rendering for the Phase 2 Day 7 editorial pipeline.
//
// Takes a source photo + caption + workspace brand context and produces a
// per-channel rendered image (1:1, 9:16, 16:9, etc.) with:
//   • Photo cropped + resized to the channel's aspect ratio
//   • Caption text in a top or bottom band
//   • Lower-third strip with clinician name + workspace name
//   • Workspace primary color as the accent
//
// Sharp + SVG composite pattern. librsvg (Sharp's text renderer) ships
// with reasonable font fallbacks; we specify 'sans-serif' for portability
// rather than depending on Titillium Web (which won't be installed on the
// Vercel function container).
//
// Video rendering is Phase 2 Day 7b — this module is photo-only for now.

import sharp from 'sharp'
import { Readable } from 'node:stream'

// Channel specs. Width × height in pixels. Add new channels here.
export const CHANNEL_SPECS = {
  linkedin_feed:        { width: 1080, height: 1080, aspect: '1:1',  captionPos: 'top' },
  instagram_reel_still: { width: 1080, height: 1920, aspect: '9:16', captionPos: 'top' },
  instagram_feed:       { width: 1080, height: 1080, aspect: '1:1',  captionPos: 'top' },
  facebook_feed:        { width: 1080, height: 1350, aspect: '4:5',  captionPos: 'top' },
  blog_hero:            { width: 1920, height: 1080, aspect: '16:9', captionPos: 'bottom' },
  tiktok_still:         { width: 1080, height: 1920, aspect: '9:16', captionPos: 'top' },
  youtube_short_still:  { width: 1080, height: 1920, aspect: '9:16', captionPos: 'top' },
}

const DEFAULT_PRIMARY = '#1a3a5c'   // navy fallback if workspace.colors is empty
const DEFAULT_ACCENT  = '#83957C'

/**
 * Escape a string for safe inclusion as SVG text content.
 */
function svgEscape(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

/**
 * Naive word-wrap that splits text into lines based on character count.
 * Returns up to maxLines lines; the last line is truncated with an ellipsis
 * if more text remains.
 */
function wrapLines(text, maxCharsPerLine, maxLines) {
  const words = String(text || '').trim().split(/\s+/)
  const lines = []
  let current = ''
  for (const word of words) {
    const next = current ? `${current} ${word}` : word
    if (next.length <= maxCharsPerLine) {
      current = next
    } else {
      if (current) lines.push(current)
      current = word
      if (lines.length >= maxLines) break
    }
  }
  if (current && lines.length < maxLines) lines.push(current)
  if (lines.length === maxLines && words.join(' ').length > lines.join(' ').length + 1) {
    // Trailing ellipsis on the last line
    lines[lines.length - 1] = lines[lines.length - 1].replace(/[.,;:!?\s]+$/, '') + '…'
  }
  return lines
}

/**
 * Build the SVG overlay for a given channel.
 * Returns a Buffer suitable for Sharp's `composite()`.
 */
export function buildBrandOverlaySvg({
  width,
  height,
  captionPos,
  captionText,
  clinicianName,
  workspaceName,
  primaryColor,
  accentColor,
}) {
  // Layout constants — proportional to the smaller dimension so they scale
  // sensibly across 1:1, 9:16, and 16:9.
  const baseDim = Math.min(width, height)
  const captionBandHeight = Math.round(baseDim * 0.18)
  const captionBandY = captionPos === 'top' ? 0 : (height - captionBandHeight)
  const lowerThirdHeight = Math.round(baseDim * 0.09)
  const lowerThirdY = height - lowerThirdHeight

  // Caption text wrap. Empirically tuned via Move Better dogfood — at 60-ish
  // font-size, sans-serif averages ~30-40px per character, so width/font*0.60
  // (≈ width/36 at 1080w) avoids clipping. Side padding adds margin against
  // text-anchor="middle" overrun.
  const captionFontSize = Math.round(baseDim * 0.048)
  const captionSidePadding = Math.round(width * 0.05)
  const captionInnerWidth = width - (2 * captionSidePadding)
  const maxCharsPerLine = Math.max(14, Math.round(captionInnerWidth / (captionFontSize * 0.55)))
  const captionLines = wrapLines(captionText, maxCharsPerLine, 3)

  // Lower-third
  const lowerFontSize = Math.round(baseDim * 0.030)
  const lowerLeftText = svgEscape(clinicianName || '')
  const lowerRightText = svgEscape(workspaceName || '')

  // Caption tspans — centered, vertically stacked
  const captionLineHeight = Math.round(captionFontSize * 1.2)
  const captionBlockHeight = captionLines.length * captionLineHeight
  const captionStartY = captionBandY + Math.round((captionBandHeight - captionBlockHeight) / 2) + captionFontSize
  const captionTspans = captionLines.map((line, i) => {
    const y = captionStartY + (i * captionLineHeight)
    return `<text x="${Math.round(width / 2)}" y="${y}" font-size="${captionFontSize}" fill="#FFFFFF" text-anchor="middle" font-family="sans-serif" font-weight="600">${svgEscape(line)}</text>`
  }).join('\n')

  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <!-- Caption band -->
  <rect x="0" y="${captionBandY}" width="${width}" height="${captionBandHeight}" fill="${primaryColor}" fill-opacity="0.88" />
  ${captionLines.length ? captionTspans : ''}

  <!-- Accent bar above lower-third -->
  <rect x="0" y="${lowerThirdY - 4}" width="${width}" height="4" fill="${accentColor}" />

  <!-- Lower-third bar -->
  <rect x="0" y="${lowerThirdY}" width="${width}" height="${lowerThirdHeight}" fill="#000000" fill-opacity="0.78" />
  <text x="${Math.round(width * 0.05)}" y="${lowerThirdY + Math.round(lowerThirdHeight * 0.62)}" font-size="${lowerFontSize}" fill="#FFFFFF" font-family="sans-serif" font-weight="500">${lowerLeftText}</text>
  <text x="${Math.round(width * 0.95)}" y="${lowerThirdY + Math.round(lowerThirdHeight * 0.62)}" font-size="${lowerFontSize}" fill="#FFFFFF" font-family="sans-serif" font-weight="400" text-anchor="end">${lowerRightText}</text>
</svg>`)
}

/**
 * Render one channel's worth of a photo asset.
 *
 * @param {Object} params
 * @param {string} params.photoUrl — source photo URL (Vercel Blob etc.)
 * @param {string} params.channel — key in CHANNEL_SPECS
 * @param {string} params.captionText — text shown in the caption band
 * @param {Object} params.workspace — workspace row (used for display_name, colors)
 * @param {string} params.clinicianName — display name for lower-third
 * @returns {Promise<{buffer: Buffer, width: number, height: number, channel: string}>}
 */
export async function renderPhotoChannel({ photoUrl, channel, captionText, workspace, clinicianName }) {
  const spec = CHANNEL_SPECS[channel]
  if (!spec) {
    throw new Error(`Unknown channel: ${channel}`)
  }

  // Fetch source photo into memory. Cap at 50MB to avoid surprise OOMs.
  const response = await fetch(photoUrl)
  if (!response.ok) {
    throw new Error(`Source fetch failed: ${response.status}`)
  }
  const contentLength = parseInt(response.headers.get('content-length') || '0', 10)
  if (contentLength > 50 * 1024 * 1024) {
    throw new Error(`Source too large: ${contentLength} bytes`)
  }
  const arrayBuf = await response.arrayBuffer()
  const buffer = Buffer.from(arrayBuf)

  // Resize + crop the source to the channel aspect (cover fit, centered).
  const photoLayer = await sharp(buffer)
    .rotate() // honor EXIF orientation
    .resize(spec.width, spec.height, { fit: 'cover', position: 'centre' })
    .jpeg({ quality: 88 })
    .toBuffer()

  // Build brand overlay SVG.
  const primaryColor = workspace?.colors?.primary || DEFAULT_PRIMARY
  const accentColor = workspace?.colors?.accent || DEFAULT_ACCENT
  const overlaySvg = buildBrandOverlaySvg({
    width: spec.width,
    height: spec.height,
    captionPos: spec.captionPos,
    captionText,
    clinicianName,
    workspaceName: workspace?.display_name || '',
    primaryColor,
    accentColor,
  })

  // Composite SVG over the photo.
  const out = await sharp(photoLayer)
    .composite([{ input: overlaySvg, top: 0, left: 0 }])
    .jpeg({ quality: 88, progressive: true })
    .toBuffer()

  return { buffer: out, width: spec.width, height: spec.height, channel }
}

// Helper to convert a Web ReadableStream → Node Readable (for streamed
// uploads to Blob if we ever need to switch from Buffer to stream).
export function bufferToNodeStream(buffer) {
  return Readable.from(buffer)
}
