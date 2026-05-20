// Image pipeline — runs after a Vercel Blob upload completes for any
// image/* media_assets row. Responsibilities:
//
//   1. Download the freshly-uploaded blob to memory (images are small enough
//      to safely fit; videos use the streaming pipeline elsewhere).
//   2. Detect HEIC/HEIF by mime + magic bytes. If sharp can decode it
//      (libvips on Vercel ships with libheif on the Linux base image), the
//      web variant is emitted as JPEG. The original HEIC stays in Blob so
//      Safari users / re-derivation still have it.
//   3. Resize to max 2000px long edge, re-encode JPEG q80 — preserving
//      PNG (with alpha) for sources that came in as PNG. The existing
//      `feedback_wp_hero_image_upload` pattern lives in api/publish/website.js
//      (resize-before-WP-upload); this module is the upstream variant that
//      runs at intake so every downstream consumer reads from the same web
//      variant.
//   4. Generate one-sentence alt text via Claude vision through the AI
//      Gateway. Failures here are non-fatal — the row gets a NULL alt_text
//      and the variant still lands.
//   5. Upload the variant to Blob at `media/web/<asset-id>.<ext>` and return
//      the URL set so the caller can PATCH the media_assets row.
//
// This module deliberately does NOT touch the DB. The caller (upload
// completion webhook or backfill script) decides how to persist the result —
// keeps the unit boundary clean and testable.

import sharp from 'sharp'
import { put as blobPut } from '@vercel/blob'
import { generateText } from 'ai'

const MAX_LONG_EDGE = 2000
const JPEG_QUALITY  = 80
const PNG_COMPRESSION = 9
const ALT_MODEL = 'anthropic/claude-sonnet-4-6'
const ALT_MAX_TOKENS = 200

// Soft cap on the bytes the pipeline will buffer in RAM. Phone JPEGs are
// 2–10 MB; brand book / scanned-PDF images can hit 50 MB. Above this we skip
// the resize (the original is already in Blob and the variant write would
// OOM the function), surfacing it as a non-fatal warning. 60 MB chosen to
// give headroom over the typical 25 MB brand-asset ceiling without risking
// the 1024 MB function memory budget when concurrent uploads land.
const MAX_DECODE_BYTES = 60 * 1024 * 1024

const ALT_PROMPT = [
  'Describe this image in one sentence for use as alt text on a clinic website.',
  'Be specific about what is visible — anatomy, activity, setting, equipment.',
  'No camera-direction phrasing like "a photo of" or "an image showing".',
  'No trailing period unless the sentence needs one for clarity.',
  'Keep under 200 characters.',
].join(' ')

// HEIC/HEIF magic-bytes detection. The ISO BMFF "ftyp" box appears in the
// first 12 bytes of every HEIF-family file. Mime alone is unreliable —
// iPhones occasionally send image/jpeg for a HEIC payload when the share
// sheet transcodes lazily, and direct API uploads may have no mime at all.
//
// Spec: ISO/IEC 14496-12 §4.3 (FileTypeBox). Major brands seen in the wild:
//   heic, heix, hevc, hevx — single still
//   mif1, msf1            — sequences (multi-image HEIC)
//   heim, heis, hevm, hevs — collections
//
// Returns true if magic bytes match, regardless of declared mime.
export function isHeicBuffer(buf) {
  if (!buf || buf.length < 12) return false
  // ftyp box: bytes 4..8 are 'ftyp', bytes 8..12 are the major brand.
  if (buf[4] !== 0x66 || buf[5] !== 0x74 || buf[6] !== 0x79 || buf[7] !== 0x70) return false
  const brand = buf.slice(8, 12).toString('ascii')
  return ['heic', 'heix', 'hevc', 'hevx', 'mif1', 'msf1', 'heim', 'heis', 'hevm', 'hevs'].includes(brand)
}

export function isHeicMime(mime) {
  if (!mime) return false
  const m = String(mime).toLowerCase()
  return m === 'image/heic' || m === 'image/heif' || m === 'image/heic-sequence' || m === 'image/heif-sequence'
}

// Decide the web-variant content-type given the source mime and decoded
// metadata. Rules:
//   HEIC/HEIF → JPEG (browser compatibility)
//   PNG       → PNG  (preserve transparency)
//   anything else → JPEG (smaller, fine for photos)
function chooseWebFormat(sourceMime, isHeic) {
  if (isHeic) return { mime: 'image/jpeg', ext: 'jpg' }
  if (sourceMime === 'image/png') return { mime: 'image/png', ext: 'png' }
  return { mime: 'image/jpeg', ext: 'jpg' }
}

// Run sharp resize + re-encode. Returns { buffer, width, height, mime }.
// Throws on unrecoverable decode failures so the caller can stamp the row
// with the error and leave the original blob_url alone.
async function resizeImage(sourceBytes, targetFormat) {
  const pipeline = sharp(sourceBytes, { failOn: 'truncated' })
    .rotate() // honor EXIF orientation so the variant matches what users expect
    .resize({
      width:            MAX_LONG_EDGE,
      height:           MAX_LONG_EDGE,
      fit:              'inside',
      withoutEnlargement: true,
    })

  let encoded
  if (targetFormat.mime === 'image/png') {
    encoded = pipeline.png({ compressionLevel: PNG_COMPRESSION, palette: true })
  } else {
    encoded = pipeline.jpeg({ quality: JPEG_QUALITY, mozjpeg: true, progressive: true })
  }

  const { data, info } = await encoded.toBuffer({ resolveWithObject: true })
  return { buffer: data, width: info.width, height: info.height, mime: targetFormat.mime }
}

// Generate one-sentence alt text via Claude vision through the AI Gateway.
// Uses generateText with a single user message that mixes the image as a file
// part and the instruction as text. Failures are non-fatal — return null and
// let the caller PATCH the row without alt_text.
async function generateAltText(imageBytes, mime) {
  if (!process.env.AI_GATEWAY_API_KEY) return null
  try {
    const { text } = await generateText({
      model: ALT_MODEL,
      maxOutputTokens: ALT_MAX_TOKENS,
      temperature: 0.2,
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: ALT_PROMPT },
          { type: 'file', data: imageBytes, mediaType: mime },
        ],
      }],
    })
    const trimmed = String(text || '').trim().replace(/^["']|["']$/g, '')
    if (!trimmed) return null
    return trimmed.slice(0, 250)
  } catch (e) {
    console.error('[imagePipeline] alt-text generation failed:', e?.message)
    return null
  }
}

// Build the Blob pathname for the web variant. Sibling to the original under
// a `media/web/` prefix so it's easy to spot in the Blob dashboard.
function webPathname(assetId, ext) {
  return `media/web/${assetId}.${ext}`
}

// Main entry point. Given a freshly-uploaded asset row's blob URL + id +
// declared mime, run the full pipeline and return the bits the caller needs
// to PATCH the row.
//
// Inputs:
//   assetId          string  — primary key of the media_assets row
//   blobUrl          string  — Vercel Blob URL of the upload (= original)
//   declaredMime     string  — mime as recorded by the upload handshake
//
// Output (on success):
//   {
//     originalBlobUrl: string,    // pass-through of the input blobUrl
//     webBlobUrl:      string,    // new Blob URL for the resized variant
//     webWidth:        number,
//     webHeight:       number,
//     webMime:         string,
//     webSizeBytes:    number,
//     originalSizeBytes: number,
//     altText:         string|null,
//     formatChanged:   boolean,   // true when HEIC→JPEG
//   }
//
// Output (skip / non-fatal):
//   null  — image was too large to decode safely, or the source wasn't an
//           image after all. Caller should leave the row alone.
export async function processImageUpload({ assetId, blobUrl, declaredMime }) {
  if (!assetId || !blobUrl) {
    throw new Error('processImageUpload: assetId + blobUrl are required')
  }

  const sourceRes = await fetch(blobUrl)
  if (!sourceRes.ok) {
    throw new Error(`processImageUpload: source fetch failed ${sourceRes.status}`)
  }
  const sourceBytes = Buffer.from(await sourceRes.arrayBuffer())
  if (sourceBytes.length > MAX_DECODE_BYTES) {
    console.warn(`[imagePipeline] asset ${assetId}: source ${sourceBytes.length} bytes exceeds ${MAX_DECODE_BYTES} cap; skipping resize`)
    return null
  }

  const heic = isHeicMime(declaredMime) || isHeicBuffer(sourceBytes)
  const target = chooseWebFormat(declaredMime, heic)

  let resized
  try {
    resized = await resizeImage(sourceBytes, target)
  } catch (e) {
    if (heic) {
      // sharp build without libheif → can't decode. Surface clearly so we
      // know whether the runtime needs a different sharp build.
      console.error(`[imagePipeline] asset ${assetId}: HEIC decode failed (libheif not available?):`, e?.message)
    } else {
      console.error(`[imagePipeline] asset ${assetId}: resize failed:`, e?.message)
    }
    throw e
  }

  const altText = await generateAltText(resized.buffer, resized.mime)

  const uploaded = await blobPut(webPathname(assetId, target.ext), resized.buffer, {
    access:          'public',
    contentType:     resized.mime,
    addRandomSuffix: true,
    allowOverwrite:  false,
  })

  return {
    originalBlobUrl:   blobUrl,
    webBlobUrl:        uploaded.url,
    webWidth:          resized.width,
    webHeight:         resized.height,
    webMime:           resized.mime,
    webSizeBytes:      resized.buffer.length,
    originalSizeBytes: sourceBytes.length,
    altText,
    formatChanged:     heic,
  }
}
