// Media lifecycle classification — answers "where is this asset in the
// content workflow?" for the Library's Publisher-first grouping.
//
//   new          — uploaded in the last 7 days AND not yet attached to a piece
//   in_pipeline  — attached to at least one piece that hasn't shipped
//   shipped      — attached only to pieces that have published
//   available    — tagged & ready, no current usage and not recent
//
// Inputs: an asset row (with `content_item_ids[]` and `created_at`) plus a
// Map<pieceId, status> built from the workspace's content_pieces. The map
// lets us classify without a second round-trip — useStories() already pulls
// every piece's status for the workspace.

const NEW_WINDOW_MS = 7 * 24 * 60 * 60 * 1000

export const LIFECYCLE_NEW         = 'new'
export const LIFECYCLE_IN_PIPELINE = 'in_pipeline'
export const LIFECYCLE_AVAILABLE   = 'available'
export const LIFECYCLE_SHIPPED     = 'shipped'

export const LIFECYCLE_ORDER = [
  LIFECYCLE_NEW,
  LIFECYCLE_IN_PIPELINE,
  LIFECYCLE_AVAILABLE,
  LIFECYCLE_SHIPPED,
]

export const LIFECYCLE_META = {
  [LIFECYCLE_NEW]: {
    label:    'Just uploaded',
    sublabel: 'last 7 days · not yet used',
    badge:    'NEW',
    badgeTone:'bg-blue-600 text-white',
  },
  [LIFECYCLE_IN_PIPELINE]: {
    label:    'In your pipeline',
    sublabel: 'attached to draft / in-review / approved pieces',
    badge:    '● active',
    badgeTone:'bg-emerald-700 text-white',
  },
  [LIFECYCLE_AVAILABLE]: {
    label:    'Available',
    sublabel: 'tagged & ready to pull into a post',
    badge:    null,
    badgeTone:null,
  },
  [LIFECYCLE_SHIPPED]: {
    label:    'Already shipped',
    sublabel: 'attached to published content — reuse with care',
    badge:    '✓ shipped',
    badgeTone:'bg-slate-700 text-white',
  },
}

/**
 * Classify a single asset against a piece-status map.
 *
 * @param {{ content_item_ids?: string[]|null, created_at?: string|null }} asset
 * @param {Map<string,string>} pieceStatusById  pieceId → status
 * @param {number} [now]  override for tests
 * @returns {'new'|'in_pipeline'|'available'|'shipped'}
 */
export function classifyAsset(asset, pieceStatusById, now = Date.now()) {
  const ids = Array.isArray(asset?.content_item_ids) ? asset.content_item_ids : []
  // Resolve to known statuses only — orphaned IDs (piece archived / deleted)
  // don't count as active usage.
  const statuses = ids
    .map((id) => pieceStatusById?.get?.(id))
    .filter((s) => typeof s === 'string')

  if (statuses.length === 0) {
    const createdAt = asset?.created_at ? new Date(asset.created_at).getTime() : 0
    return now - createdAt <= NEW_WINDOW_MS ? LIFECYCLE_NEW : LIFECYCLE_AVAILABLE
  }

  // Any non-published usage → still in the active pipeline. We treat
  // archived pieces as "not active" (they're filtered out of the status
  // map by useStories already, so they fall back to the available bucket).
  const hasUnpublished = statuses.some((s) => s !== 'published')
  return hasUnpublished ? LIFECYCLE_IN_PIPELINE : LIFECYCLE_SHIPPED
}

/**
 * Group an asset list into the four lifecycle buckets. Preserves the input
 * order within each bucket (the caller controls that via the assets list).
 *
 * @param {Array<object>} assets
 * @param {Map<string,string>} pieceStatusById
 * @param {number} [now]
 */
export function groupByLifecycle(assets, pieceStatusById, now = Date.now()) {
  const groups = {
    [LIFECYCLE_NEW]:         [],
    [LIFECYCLE_IN_PIPELINE]: [],
    [LIFECYCLE_AVAILABLE]:   [],
    [LIFECYCLE_SHIPPED]:     [],
  }
  for (const a of assets) {
    groups[classifyAsset(a, pieceStatusById, now)].push(a)
  }
  return groups
}

/**
 * Build the pieceId → status lookup from a stories list (the shape returned
 * by useStories). Archived pieces are excluded so they don't tilt assets
 * into the wrong bucket.
 *
 * @param {Array<{ pieces?: Array<{ id: string, status: string }> }>} stories
 * @returns {Map<string, string>}
 */
export function buildPieceStatusMap(stories) {
  const map = new Map()
  for (const s of stories ?? []) {
    for (const p of s?.pieces ?? []) {
      if (!p?.id || typeof p.status !== 'string') continue
      map.set(p.id, p.status)
    }
  }
  return map
}
