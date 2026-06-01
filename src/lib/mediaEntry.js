// Single source of truth for the content_items.media_urls entry shape:
//   { url, type: 'image'|'video', kind, thumbnailUrl, mediaAssetId, name, duration_s? }
//
// Both the suggestion path (searchClips / suggest-media result rows) and the
// manual Library picker (media_assets rows) normalize THROUGH here, so
// PostPreview + the Buffer dispatcher read an identical shape no matter how the
// media was attached. Never store a bare string url — a bare string publishes a
// video as a broken image (memory: content_items.media_urls shape).
//
// Lifted out of MediaSuggestions.jsx / MediaAttachmentPanel.jsx in the
// Storyboard rebuild so the queue page, the focused page, and the manual picker
// all share one definition instead of three drifting copies.

// A searchClips / suggest-media result row → media_urls entry.
export function clipToMediaEntry(clip) {
  const isVideo = clip.kind === 'video'
  const url = clip.blobUrl || clip.url
  return {
    url,
    type:         isVideo ? 'video' : 'image',
    kind:         isVideo ? 'video' : 'image',
    thumbnailUrl: clip.thumbnailUrl || (isVideo ? null : url),
    mediaAssetId: clip.assetId,
    name:         clip.filename || null,
    ...(clip.durationS != null ? { duration_s: clip.durationS } : {}),
  }
}

// A MediaPicker / media_assets row → media_urls entry.
export function pickerItemToMediaEntry(asset) {
  const isVideo = asset.kind === 'video'
  const url     = asset.rendered_url || asset.blob_url || asset.url
  return {
    url,
    type:         isVideo ? 'video' : 'image',
    kind:         isVideo ? 'video' : 'image',
    thumbnailUrl: asset.thumbnail_url || asset.thumbnailUrl || (isVideo ? null : url),
    mediaAssetId: asset.id,
    name:         asset.filename || asset.name,
    ...(asset.duration_s != null ? { duration_s: asset.duration_s } : {}),
  }
}

// Stable dedup/identity key for a media entry — the asset id when known, else
// the url. Used to dedupe attaches and to filter already-attached candidates.
export function mediaEntryKey(entry) {
  return entry.mediaAssetId || entry.url
}

// True when a media_urls entry is a video. Checks both `kind` and `type`
// because the two normalizers above set both, but older rows / other writers
// may carry only one. One predicate so every surface (preview, composer gate,
// publish) agrees on what counts as a video.
export function isVideoEntry(entry) {
  return entry?.kind === 'video' || entry?.type === 'video'
}

// True when an Instagram piece should publish as a Reel rather than a photo
// carousel: it has at least one video attached. Instagram (and Buffer) treat a
// post as EITHER an all-photo carousel OR a single-video Reel — they can't be
// mixed through our publisher — so the presence of any video makes it a Reel.
// (Mixed photo+video carousels are parked in .claude/ideas.md, blocked on
// Buffer.) Shared so the preview, the composer gate, and any reel-specific UI
// make the same call from the same media_urls array.
export function isInstagramReel(mediaUrls) {
  return Array.isArray(mediaUrls) && mediaUrls.some(isVideoEntry)
}
