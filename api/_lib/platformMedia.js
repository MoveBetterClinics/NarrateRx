// Map a content_items.platform value → the media kind that's valid to attach,
// so the media→content matcher (api/content-items/suggest-media.js) never
// suggests media a platform can't use (the "photos on YouTube" bug).
//
// Platform values are the atom/publish namespace keys (content_items.platform):
// instagram, facebook, tiktok, youtube, blog, landing_page, gbp, linkedin, …
// Classification mirrors src/lib/contentMeta.js PLATFORM_GROUPS + outputChannels.js.
//
//   'video' → only video makes sense (you can't post a photo to YouTube/TikTok)
//   'photo' → only a still works (a raw video can't be a blog/landing hero — it
//             would fail the image-hero publish path)
//   null    → either is fine (IG / FB / GBP accept photo or video)

// Video-only surfaces — a still image is unusable here.
const VIDEO_ONLY = new Set([
  'youtube', 'youtube_short', 'tiktok', 'reels', 'instagram_reel',
])

// Image-only surfaces — the attached media is a hero/still; a raw video would
// publish broken (e.g. the WordPress hero path sharp-resizes an image).
const PHOTO_ONLY = new Set([
  'blog', 'landing_page', 'google_ads', 'email',
])

/**
 * @param {string|null|undefined} platform
 * @returns {'video'|'photo'|null}
 */
export function mediaKindForPlatform(platform) {
  if (!platform) return null
  const p = String(platform).toLowerCase()
  if (VIDEO_ONLY.has(p)) return 'video'
  if (PHOTO_ONLY.has(p)) return 'photo'
  return null
}
