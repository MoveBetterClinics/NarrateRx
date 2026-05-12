async function apiFetch(path, init = {}) {
  const res = await fetch(path, init)
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(json.error || `Request failed: ${res.status}`)
  return json
}

// ── Content items ────────────────────────────────────────────────────────────

export function fetchContentItems(filters = {}) {
  const params = new URLSearchParams()
  if (filters.status)   params.set('status', filters.status)
  if (filters.platform) params.set('platform', filters.platform)
  if (filters.from)     params.set('from', filters.from)
  if (filters.to)       params.set('to', filters.to)
  if (filters.limit)    params.set('limit', String(filters.limit))
  const qs = params.toString()
  return apiFetch(`/api/db/content${qs ? `?${qs}` : ''}`)
}

export function fetchContentItem(id) {
  return apiFetch(`/api/db/content?id=${encodeURIComponent(id)}`)
}

export function fetchContentItemsByInterview(interviewId) {
  return apiFetch(`/api/db/content?interviewId=${encodeURIComponent(interviewId)}`)
}

export function updateContentItem(id, patch) {
  return apiFetch(`/api/db/content?id=${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  })
}

export function deleteContentItem(id) {
  return apiFetch(`/api/db/content?id=${encodeURIComponent(id)}`, { method: 'DELETE' })
}

export function createContentItems(items) {
  return apiFetch('/api/db/content', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(Array.isArray(items) ? items : [items]),
  })
}

// ── Publishing ────────────────────────────────────────────────────────────────

// Buffer is the universal distribution path. As of 2026-05-11 every social +
// local surface (including GBP) routes through Buffer — there are no direct
// platform integrations left. To add a new Buffer-supported platform: (1) add
// to BUFFER_PLATFORMS, (2) add the matching service string to
// PLATFORM_TO_SERVICE in api/publish/buffer.js, (3) add a prompt generator in
// src/lib/prompts.js.
//
// `locationIds` only applies to gbp: it carries an array of workspace_locations
// row UUIDs selected in the Review picker. The buffer endpoint resolves those
// to Buffer GBP profile IDs via workspace_locations.gbp_location_id. Empty/
// missing means "fan out to every active location with a Buffer GBP channel".
const BUFFER_PLATFORMS = [
  'instagram', 'facebook', 'linkedin', 'pinterest',
  'tiktok', 'youtube_short', 'twitter', 'threads', 'bluesky', 'mastodon',
  'gbp',
]

export async function publishItem(item, { scheduledAt } = {}) {
  const { platform, content, mediaUrls = [], locationIds } = item
  const results = {}

  if (BUFFER_PLATFORMS.includes(platform)) {
    const body = { platform, content, mediaUrls, scheduledAt }
    if (platform === 'gbp' && locationIds?.length) body.locationIds = locationIds
    results.buffer = await apiFetch('/api/publish/buffer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  }

  return results
}

// ── Website publish (workspace-agnostic; gated by workspace.capabilities.websitePublish) ─
// Server-side dispatcher in api/publish/website.js picks Astro or WordPress
// mode from env vars. Throws an Error whose `.code` is one of: slug_taken,
// invalid_payload, auth_failed, website_misconfigured, github_error,
// media_upload_failed, tag_resolve_failed, network_error, not_configured,
// upstream_error. The UI keys off `.code` to render the right message
// (slug-taken in particular needs to highlight the slug input).
export async function publishBlogToWebsite(post) {
  const res = await fetch('/api/publish/website', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(post),
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) {
    const error = new Error(json.message || `Publish failed (${res.status})`)
    error.code = json.error || 'upstream_error'
    error.status = res.status
    error.details = json
    throw error
  }
  return json
}

// Universal Buffer-eligible platform list — exposed so workbench UIs know which
// targets they can dispatch to. Mirrors PLATFORM_TO_SERVICE in api/publish/buffer.js.
export const BUFFER_DISPATCH_PLATFORMS = BUFFER_PLATFORMS

// ── Workbench dispatch (Media Hub editor briefs) ─────────────────────────────
// Materializes an edit brief into a content_items row and pushes it through the
// universal api/publish/buffer.js endpoint. Returns the new content_items row.
//
// Keeps content_items as the canonical published-post record while leaving the
// brief (content_pieces row) intact as the editor's draft surface — callers
// stamp brief.status='published' + published_target_id=<item.id> afterward.
export async function dispatchBrief({
  brief,
  asset,            // media_assets row for the final or source clip
  composedContent,  // caption + hashtags + cta string, prepared by the workbench
  scheduledAt,      // ISO string | null
  locationIds,      // optional, gbp only
  userId,
}) {
  if (!brief?.target_platform) throw new Error('Pick a target platform first')
  if (!composedContent?.trim()) throw new Error('Empty post body')

  const mediaUrls = asset?.blob_url
    ? [{ url: asset.blob_url, type: asset.kind === 'video' ? 'video' : 'photo' }]
    : []

  // 1. Create the canonical content_items row.
  const [created] = await apiFetch('/api/db/content', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify([{
      platform: brief.target_platform,
      content: composedContent,
      status: scheduledAt ? 'scheduled' : 'draft',
      media_urls: mediaUrls,
      scheduled_at: scheduledAt || null,
      notes: `Dispatched from brief ${brief.id}`,
    }]),
  })
  if (!created?.id) throw new Error('Failed to create content item')

  // 2. Dispatch through Buffer (no parallel dispatcher logic).
  const item = {
    id: created.id,
    platform: brief.target_platform,
    content: composedContent,
    mediaUrls,
    scheduledAt,
    locationIds: brief.target_platform === 'gbp' ? locationIds : undefined,
  }
  const result = await publishAndTrack(item, userId)
  return { item: created, result }
}

// Publish one item to all relevant platforms at once
export async function publishAndTrack(item, userId) {
  const result = await publishItem(item, { scheduledAt: item.scheduledAt })
  const postId = result.buffer?.bufferId

  await updateContentItem(item.id, {
    status: item.scheduledAt ? 'scheduled' : 'published',
    publishedAt: item.scheduledAt ? null : new Date().toISOString(),
    platformPostId: postId,
    bufferUpdateId: result.buffer?.bufferId,
    approvedBy: userId,
  })

  return result
}
