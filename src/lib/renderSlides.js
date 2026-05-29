// Bake carousel slides (photo + on-screen text) into real images and upload
// them, so the text the user sees in the preview actually ships to the live
// post. Before this, the per-slide freeform overlay (content_items.slides) was
// only drawn to a client <canvas> for preview and never persisted as an image —
// publish sent the raw photos, so on-screen text silently vanished.
//
// Used in two places:
//   • SlideEditor.handleSave  — eager render so the row is publish-ready and
//     publish stays instant (and scheduled/Buffer dispatch gets the URLs).
//   • AssetsPane.handlePublish — lazy fallback for slides saved before this
//     feature (or edited without re-saving), so publish is always correct.
//
// Each slide carries `rendered_url` + `rendered_sig` (a hash of its
// render-affecting inputs). We re-render only slides whose signature changed,
// so repeated saves/publishes don't re-upload unchanged slides.

import { apiFetch } from '@/lib/api'
import { renderFreeformSlide, SIZE } from '@/lib/overlayTemplates'

// Photos the editor exposes for binding: non-video media with a URL. photo_idx
// on a slide indexes into THIS filtered list (must match SlideEditor's filter).
export function slidePhotos(mediaUrls) {
  return (mediaUrls || []).filter((m) => m && m.type !== 'video' && m.url)
}

// Small, fast, dependency-free string hash → short hex. Stable across reloads
// (no Math.random / Date). Good enough to detect "did the render inputs change".
function hashString(str) {
  let h1 = 0xdeadbeef ^ str.length
  let h2 = 0x41c6ce57 ^ str.length
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i)
    h1 = Math.imul(h1 ^ ch, 2654435761)
    h2 = Math.imul(h2 ^ ch, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return (h2 >>> 0).toString(16).padStart(8, '0') + (h1 >>> 0).toString(16).padStart(8, '0')
}

// Signature of everything that affects the rendered pixels. If any of these
// change, the cached rendered_url is stale and the slide is re-rendered.
function slideSignature({ slide, photoUrl, themeId, brandStyle }) {
  return hashString(JSON.stringify({
    blocks: (slide.blocks || []).map((b) => ({ text: b.text, role: b.role, position: b.position })),
    template: slide.template || null,
    photoUrl: photoUrl || null,
    themeId: themeId || null,
    brand: brandStyle || null,
  }))
}

function canvasToJpegDataUrl(canvas) {
  // JPEG keeps slide files small (IG recompresses anyway); 0.92 keeps text crisp.
  return canvas.toDataURL('image/jpeg', 0.92)
}

async function renderAndUploadSlide({ slide, photoUrl, brandStyle, theme, sig, pieceId, idx }) {
  const canvas = document.createElement('canvas')
  canvas.width = SIZE
  canvas.height = SIZE
  await renderFreeformSlide({ sourceUrl: photoUrl || null, slide, brandStyle: brandStyle || {}, canvas, theme })
  const dataUrl = canvasToJpegDataUrl(canvas)
  const { url } = await apiFetch('/api/editorial/upload-slide', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pieceId, idx, sig, dataUrl }),
  })
  if (!url) throw new Error('Slide upload returned no URL')
  return url
}

// Ensure every slide has an up-to-date baked image. Re-renders only changed
// slides. Returns:
//   { slides }            — slides with rendered_url + rendered_sig populated
//   { publishMediaUrls }  — [{ url, type:'photo' }] in slide order, ready for Buffer
//   { changed }           — true if any slide was (re)rendered (caller persists)
export async function ensureRenderedSlides({ slides, mediaUrls, brandStyle, theme, themeId, pieceId }) {
  const photos = slidePhotos(mediaUrls)
  const out = []
  let changed = false

  for (let idx = 0; idx < slides.length; idx++) {
    const slide = slides[idx]
    const photoUrl = typeof slide.photo_idx === 'number' && photos[slide.photo_idx]
      ? photos[slide.photo_idx].url
      : null
    const sig = slideSignature({ slide, photoUrl, themeId, brandStyle })

    if (slide.rendered_url && slide.rendered_sig === sig) {
      out.push(slide)
      continue
    }
    const url = await renderAndUploadSlide({ slide, photoUrl, brandStyle, theme, sig, pieceId, idx })
    out.push({ ...slide, rendered_url: url, rendered_sig: sig })
    changed = true
  }

  const publishMediaUrls = out
    .filter((s) => s.rendered_url)
    .map((s) => ({ url: s.rendered_url, type: 'photo' }))

  return { slides: out, publishMediaUrls, changed }
}
