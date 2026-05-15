// Client-side build of the publish image manifest. Mirrors the read-only half
// of api/_lib/publishImageMirror.js — the server owns rewriteMarkdownImageUrls
// since only the WP path runs it. Keep the two files in sync; they share unit
// tests at tests/unit/publishImageMirror.test.js.

const MD_IMAGE_RE = /!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g

function isMirrorableUrl(url) {
  if (typeof url !== 'string' || !url) return false
  if (!/^https?:\/\//i.test(url)) return false
  return (
    /\.public\.blob\.vercel-storage\.com/i.test(url) ||
    /\.blob\.vercel-storage\.com/i.test(url) ||
    /\.narraterx\.ai\//i.test(url)
  )
}

function extOf(url, fallback = 'jpg') {
  try {
    const u = new URL(url)
    const last = u.pathname.split('/').pop() || ''
    const dot = last.lastIndexOf('.')
    if (dot > 0 && dot < last.length - 1) return last.slice(dot + 1).toLowerCase().split('?')[0]
  } catch { /* fall through */ }
  return fallback
}

export function extractInlineImages(markdown) {
  if (typeof markdown !== 'string' || !markdown) return []
  const out = []
  const seen = new Set()
  let m
  MD_IMAGE_RE.lastIndex = 0
  while ((m = MD_IMAGE_RE.exec(markdown)) !== null) {
    const alt = (m[1] || '').trim()
    const url = m[2]
    if (!url || seen.has(url)) continue
    seen.add(url)
    out.push({ alt, url })
  }
  return out
}

export function pickHero(mediaUrls) {
  if (!Array.isArray(mediaUrls)) return null
  for (const entry of mediaUrls) {
    if (!entry) continue
    const isImage = entry.kind === 'image' || entry.type === 'image' || entry.type === 'photo'
    if (!isImage) continue
    const url = entry.url || entry.blob_url || entry.rendered_url
    if (!url) continue
    const alt = entry.alt || entry.name || ''
    return { url, alt }
  }
  return null
}

function defaultFilename(slug, idx, url) {
  const safeSlug = String(slug || 'post').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'post'
  return `${safeSlug}-${idx}.${extOf(url)}`
}

export function buildImagesManifest({ markdown, mediaUrls, slug } = {}) {
  const hero = pickHero(mediaUrls)
  const inline = extractInlineImages(markdown)
  const heroUrl = hero?.url
  const bodyImages = inline.filter((img) => img.url !== heroUrl)
  const images = bodyImages.map((img, idx) => ({
    url:        img.url,
    alt:        img.alt,
    filename:   defaultFilename(slug, idx + 1, img.url),
    mirrorable: isMirrorableUrl(img.url),
  }))
  return {
    heroImage:    heroUrl || undefined,
    heroImageAlt: hero?.alt || undefined,
    images,
  }
}
