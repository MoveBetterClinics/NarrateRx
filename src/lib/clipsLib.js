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
