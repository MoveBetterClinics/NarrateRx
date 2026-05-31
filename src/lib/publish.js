import { apiFetch } from '@/lib/api'

// ── Content items ────────────────────────────────────────────────────────────

export function fetchContentItems(filters = {}) {
  const params = new URLSearchParams()
  if (filters.status)      params.set('status', filters.status)
  if (filters.platform)    params.set('platform', filters.platform)
  if (filters.from)        params.set('from', filters.from)
  if (filters.to)          params.set('to', filters.to)
  if (filters.limit)       params.set('limit', String(filters.limit))
  if (filters.interviewId) params.set('interviewId', filters.interviewId)
  // 'only' → archived rows only; 'all' → live + archived. Omitting hides
  // archived rows (the default the Hub wants).
  if (filters.archived) params.set('archived', String(filters.archived))
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

// ── Media → content matching (Phase P0) ──────────────────────────────────────

// Ranked media candidates to attach to a draft, from the visual-memory matcher
// (api/content-items/suggest-media.js). Powers the in-editor suggestion strip
// and the "drafts needing media" worklist. `opts` may carry { kind, minScore, k }.
export function suggestMediaForDraft(id, opts = {}) {
  return apiFetch('/api/content-items/suggest-media', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, ...opts }),
  })
}

export function suggestHashtags(contentItemId) {
  return apiFetch('/api/content/suggest-hashtags', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contentItemId }),
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
  'tiktok', 'youtube_short', 'youtube', 'twitter', 'threads', 'bluesky', 'mastodon',
  'gbp',
]

export async function publishItem(item, { scheduledAt, useQueue } = {}) {
  const { platform, content, mediaUrls = [], locationIds, location_overrides } = item
  const results = {}

  if (BUFFER_PLATFORMS.includes(platform)) {
    const body = { platform, content, mediaUrls, scheduledAt, useQueue }
    if (platform === 'gbp') {
      if (locationIds?.length) body.locationIds = locationIds
      // Pass per-location content overrides so the Buffer route posts distinct
      // copy to each Google listing instead of the same canonical body.
      if (location_overrides && typeof location_overrides === 'object') {
        body.locationContents = Object.fromEntries(
          Object.entries(location_overrides).map(([id, v]) => [id, v.content]),
        )
      }
    }
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
  try {
    return await apiFetch('/api/publish/website', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(post),
    })
  } catch (err) {
    // Preserve the {code, status, details} shape callers branch on
    // (slug-taken UI needs `.code` to highlight the slug input).
    if (err?.name === 'ApiError') {
      const wrapped = new Error(err.payload?.message || err.message || `Publish failed (${err.status})`)
      wrapped.code = err.payload?.error || 'upstream_error'
      wrapped.status = err.status
      wrapped.details = err.payload
      throw wrapped
    }
    throw err
  }
}

// ── Beehiiv publish (newsletter draft) ──────────────────────────────────────
// Pushes a blog post to Beehiiv as a DRAFT. The tenant finishes the post in
// Beehiiv (thumbnail review, audience picker, scheduling). Throws an Error
// whose `.code` is one of: not_configured, auth_failed, publication_not_found,
// invalid_payload, rate_limited, network_error, upstream_error.
export async function sendBlogToBeehiiv(post) {
  try {
    return await apiFetch('/api/publish/beehiiv', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(post),
    })
  } catch (err) {
    if (err?.name === 'ApiError') {
      const wrapped = new Error(err.payload?.message || err.message || `Beehiiv publish failed (${err.status})`)
      wrapped.code = err.payload?.error || 'upstream_error'
      wrapped.status = err.status
      wrapped.details = err.payload
      throw wrapped
    }
    throw err
  }
}

// Universal Buffer-eligible platform list — exposed so workbench UIs know which
// targets they can dispatch to. Mirrors PLATFORM_TO_SERVICE in api/publish/buffer.js.
export const BUFFER_DISPATCH_PLATFORMS = BUFFER_PLATFORMS

// Cancel a scheduled Buffer post by its bufferUpdateId. The endpoint treats
// "already gone" (NotFoundError) as success — idempotent. Throws on real
// failures so callers can keep the row in 'scheduled' on error.
export async function cancelBufferPost(bufferUpdateId) {
  return apiFetch('/api/publish/buffer', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ bufferUpdateId }),
  })
}

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

// Publish one item to all relevant platforms at once.
//
// item.useQueue (boolean): when true on a Buffer platform, the post is added
// to Buffer's existing queue (shareNext) instead of being given a specific
// dueAt or fired immediately. The resulting content_items row is marked
// `scheduled` even though we don't know the exact dueAt up-front — Buffer
// returns one in the webhook payload and downstream sync fills it in.
export async function publishAndTrack(item, userId) {
  const result = await publishItem(item, { scheduledAt: item.scheduledAt, useQueue: item.useQueue })
  const postId = result.buffer?.bufferId
  const dueAt = result.buffer?.scheduledAt || null
  const willBeScheduled = !!item.scheduledAt || !!item.useQueue

  await updateContentItem(item.id, {
    status: willBeScheduled ? 'scheduled' : 'published',
    publishedAt: willBeScheduled ? null : new Date().toISOString(),
    platformPostId: postId,
    bufferUpdateId: result.buffer?.bufferId,
    approvedBy: userId,
    // When Buffer assigned the slot (queue mode), echo it back to the row so the
    // calendar shows the right time without waiting for a webhook round-trip.
    ...(item.useQueue && dueAt ? { scheduledAt: dueAt } : {}),
  })

  return result
}
