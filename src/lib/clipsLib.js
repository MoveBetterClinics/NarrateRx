// Client helpers for multi-clip video v1 — transcript-based segment detection
// + review. One long source video → many proposed standalone clips, each kept
// segment rendered into its own story package.
//
// All requests go through apiFetch, which attaches the short-lived Clerk JWT;
// the editorial endpoints verify it and enforce video_pipeline_enabled +
// workspace scoping server-side.

import { apiFetch } from '@/lib/api'

/**
 * Kick off segment detection for a source video. Returns immediately (202);
 * the asset's segment_status flips 'detecting' → 'ready' | 'failed'. Poll
 * getSegments() to track progress.
 * @param {string} assetId
 * @param {number} [maxSegments]
 */
export function findClips(assetId, maxSegments) {
  return apiFetch('/api/editorial/find-clips', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ assetId, ...(maxSegments ? { maxSegments } : {}) }),
  })
}

/**
 * Fetch detection status + proposed/kept/rendered segments for a source asset.
 * @param {string} assetId
 * @returns {Promise<{assetId: string, status: string|null, error: string|null, detectedAt: string|null, segments: object[]}>}
 */
export function getSegments(assetId) {
  return apiFetch(`/api/editorial/segments?assetId=${encodeURIComponent(assetId)}`)
}

/**
 * Set a segment's review status (keep / discard / reset to proposed).
 * @param {string} segmentId
 * @param {'kept'|'discarded'|'proposed'} status
 */
export function updateSegment(segmentId, status) {
  return apiFetch(`/api/editorial/segments/${encodeURIComponent(segmentId)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status }),
  })
}

/**
 * Render the given segments into story packages (one per segment). Returns 202
 * with { packages, skipped }; the Slate polls story_packages for completion.
 * @param {string[]} segmentIds
 */
export function renderSegments(segmentIds) {
  return apiFetch('/api/editorial/render-segments', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ segmentIds }),
  })
}

/**
 * Render the WHOLE source video as one keep-whole, landscape long-form story
 * package — the other explicit choice next to "Find clips". Returns 202 with
 * { packageId, status, channels }; the Slate polls story_packages for
 * completion. Anything over the 120s long-form cap is trimmed until the
 * chunked-render follow-up.
 * @param {string} assetId
 */
export function renderWholeVideo(assetId) {
  return apiFetch('/api/editorial/render-longform', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ assetId }),
  })
}

/**
 * Repurpose A2 — one-click campaign-bundled repurpose. Creates (or reuses) a
 * "Repurpose: <filename>" campaign, kicks the keep-whole long-form master render
 * AND social-clip detection — both tagged to the same campaign. Returns 202 with
 * { campaignId, campaignName, masterPackageId, clipsStatus, mode, channels }.
 * Track the master in the Story Slate; review proposed clips in the ClipFinder panel.
 * @param {string} assetId
 * @param {number} [maxSegments]
 */
export function repurposeVideo(assetId, maxSegments) {
  return apiFetch('/api/editorial/repurpose-video', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ assetId, ...(maxSegments ? { maxSegments } : {}) }),
  })
}
