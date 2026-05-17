import { put as blobPut } from '@vercel/blob'
import { createHash } from 'node:crypto'

// Buffer's per-platform image-dimension caps trip on phone-camera images
// (5472px wide is common). Instagram is the tightest at 5000px; Twitter caps
// at 4096px. Resizing once to 4000px wide keeps us under every platform limit
// while preserving plenty of resolution for vertical phone screens.
const MAX_WIDTH = 4000
const RESIZED_PREFIX = 'media/publish-resized'

// Resize a single image URL if it exceeds MAX_WIDTH, uploading the resized
// JPEG to a deterministic blob path (hash of source URL) so repeated
// publishes of the same asset reuse the same blob and don't fan out orphans.
// Returns the URL to send Buffer — either the original (if small enough or
// not an image) or the resized blob URL.
async function resizeIfNeeded(url) {
  if (typeof url !== 'string' || !url) return url

  const r = await fetch(url)
  if (!r.ok) {
    throw new Error(`download failed: ${r.status}`)
  }
  const contentType = (r.headers.get('content-type') || '').toLowerCase()
  if (!contentType.startsWith('image/')) {
    // Not an image (e.g. video) — caller skips video resizing entirely, but
    // bail safely if a misclassified asset slips through.
    return url
  }
  const buf = Buffer.from(await r.arrayBuffer())

  const { default: sharp } = await import('sharp')
  const img = sharp(buf, { failOn: 'none' }).rotate()
  const meta = await img.metadata().catch(() => ({}))
  if (!meta.width || meta.width <= MAX_WIDTH) {
    return url
  }

  const resized = await img
    .resize({ width: MAX_WIDTH, withoutEnlargement: true })
    .jpeg({ quality: 88 })
    .toBuffer()

  const hash = createHash('sha256').update(url).digest('hex').slice(0, 16)
  const path = `${RESIZED_PREFIX}/${hash}-${MAX_WIDTH}.jpg`
  const uploaded = await blobPut(path, resized, {
    access: 'public',
    contentType: 'image/jpeg',
    addRandomSuffix: false,
    allowOverwrite: true,
  })
  return uploaded.url
}

// Walk a mediaUrls array, downsizing every oversized image. Videos are
// passed through untouched (transcode is a future, heavier feature). On
// individual resize errors we log and fall through to the original URL so
// the publish can still proceed; Buffer will only reject if the image
// genuinely exceeds the platform's cap.
export async function prepareMediaForBuffer(mediaUrls) {
  if (!Array.isArray(mediaUrls) || mediaUrls.length === 0) return mediaUrls || []
  return Promise.all(
    mediaUrls.map(async (m) => {
      if (!m || typeof m !== 'object') return m
      if (m.type?.startsWith('video')) return m
      try {
        const newUrl = await resizeIfNeeded(m.url)
        if (!newUrl || newUrl === m.url) return m
        return { ...m, url: newUrl }
      } catch (e) {
        console.error('[publish/buffer] image resize failed', m.url, e?.message)
        return m
      }
    }),
  )
}

export const __test = { MAX_WIDTH, RESIZED_PREFIX }
